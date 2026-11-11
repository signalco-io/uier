import { expect, test, type APIRequestContext, type Page, type Route, type TestInfo } from '@playwright/test';
import { commentRowLink, createProject, hydrated, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

const featureMarkers = {
    board: (body: string) => body.includes('data-board-scroll')
};
type Feature = keyof typeof featureMarkers;

/** Inspect actual production responses, so hashed chunk names may change between optimized builds. */
async function featureGate(page: Page, feature: Feature) {
    const attempts: { url: string; result: 'loaded' | 'held' | 'failed' }[] = [];
    let pending = Promise.resolve();
    let releasePending = () => {};
    let hold = false;
    let failures = 0;
    const pattern = /\/_next\/static\/chunks\/.*\.js(?:\?.*)?$/;
    const handler = async (route: Route) => {
        const response = await route.fetch();
        if (!featureMarkers[feature](await response.text())) {
            await route.fulfill({ response });
            return;
        }
        const attempt = { url: route.request().url(), result: 'loaded' as 'loaded' | 'held' | 'failed' };
        attempts.push(attempt);
        if (failures > 0) {
            failures--;
            attempt.result = 'failed';
            await route.abort('failed');
            return;
        }
        if (hold) {
            attempt.result = 'held';
            await pending;
        }
        attempt.result = 'loaded';
        await route.fulfill({ response });
    };
    await page.route(pattern, handler);
    return {
        attempts,
        hold() {
            hold = true;
            pending = new Promise<void>(resolve => { releasePending = resolve; });
        },
        release() {
            hold = false;
            releasePending();
        },
        failTwice() { failures = 2; },
        async dispose(info: TestInfo) {
            hold = false;
            releasePending();
            await page.unroute(pattern, handler);
            await info.attach(`${feature}-chunk-requests`, { body: JSON.stringify(attempts, null, 2), contentType: 'application/json' });
        }
    };
}

async function project(page: Page, request: APIRequestContext) {
    await signIn(page, uniqueEmail('bundle-boundary'));
    const id = await createProject(page, { urls: [site.origin()], name: 'Deferred project' });
    await setProjectAccess(page, id, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, id, site.origin());
    const response = await request.post(`/api/review/${id}/comments`, { headers, data: {
        path: `/${id}/pricing`, text: 'Deferred boundary thread', authorName: 'Reviewer', position: { type: 'page' }, kind: 'feedback'
    } });
    expect(response.status()).toBe(201);
    const comment = await response.json() as { number: number };
    await page.goto(`/app/projects/${id}`);
    await expect(page.getByRole('list', { name: 'Comments', exact: true }).getByRole('listitem')).toHaveCount(1);
    await hydrated(page.getByRole('button', { name: 'Board', exact: true }));
    return { id, number: comment.number };
}

// No smoke tags: these cover code-splitting failure and focus permutations.
test('deferred board stays off List and preserves controls through delayed loading', async ({ page, request }, info) => {
    const gate = await featureGate(page, 'board');
    try {
        const { number } = await project(page, request);
        expect(gate.attempts).toHaveLength(0);
        gate.hold();
        await page.getByRole('button', { name: 'Board', exact: true }).click();
        await expect(page.getByRole('status').filter({ hasText: 'Loading board…' })).toBeVisible();
        const search = page.getByRole('searchbox', { name: 'Search feedback' });
        await search.fill('boundary');
        await expect(search).toHaveValue('boundary');
        await page.getByRole('button', { name: 'List', exact: true }).click();
        await expect(page.getByRole('list', { name: 'Comments', exact: true })).toBeVisible();
        gate.release();
        await page.getByRole('button', { name: 'Board', exact: true }).click();
        const open = page.getByRole('region', { name: 'Open comments', exact: true });
        await expect(open.getByRole('listitem')).toHaveCount(1);
        await expect(search).toHaveValue('boundary');
        await commentRowLink(open, number).focus();
        await page.keyboard.press('m');
        await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
        await expect(page.getByRole('region', { name: 'Done comments', exact: true }).getByRole('listitem')).toHaveCount(1);
        // Direct Board visits preload their dynamic chunk while rendering the document. This
        // avoids waiting for parent hydration to start fetching an already visible board.
        const targetPaths = [...new Set(gate.attempts.map(attempt => new URL(attempt.url).pathname))];
        const response = await page.reload();
        const html = await response!.text();
        const hints = [...html.matchAll(/<link\b[^>]*>/g)].map(match => match[0]);
        expect(targetPaths.some(path => hints.some(link => link.includes(path)
            && link.includes('rel="preload"') && link.includes('as="script"')))).toBe(true);
        await expect(page.getByRole('region', { name: 'Done comments', exact: true }).getByRole('listitem')).toHaveCount(1);
    } finally { await gate.dispose(info); }
});

test('deferred board retries a failed chunk and can close and reopen after recovery', async ({ page, request }, info) => {
    const gate = await featureGate(page, 'board');
    try {
        await project(page, request);
        expect(gate.attempts).toHaveLength(0);
        // Installed Turbopack retries a failed network chunk once before rejecting.
        gate.failTwice();
        await page.getByRole('button', { name: 'Board', exact: true }).click();
        await expect(page.getByRole('alert').filter({ hasText: 'The board could not load.' })).toBeVisible();
        expect(gate.attempts.filter(attempt => attempt.result === 'failed')).toHaveLength(2);
        const beforeRetry = gate.attempts.length;
        await page.getByRole('button', { name: 'Try loading the board again', exact: true }).click();
        const open = page.getByRole('region', { name: 'Open comments', exact: true });
        await expect(open.getByRole('listitem')).toHaveCount(1);
        expect(gate.attempts.length).toBeGreaterThan(beforeRetry);
        await page.getByRole('button', { name: 'List', exact: true }).click();
        await page.getByRole('button', { name: 'Board', exact: true }).click();
        await expect(open.getByRole('listitem')).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Try loading the board again', exact: true })).toHaveCount(0);
    } finally { await gate.dispose(info); }
});

