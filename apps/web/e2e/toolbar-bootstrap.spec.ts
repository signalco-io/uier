import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type TestInfo } from '@playwright/test';
import { createProject, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { newVisitor, toolbar } from './support/toolbar';

const reviewBytes = readFileSync(new URL('../../../packages/toolbar/dist/review.js', import.meta.url));
const reviewPath = `/toolbar/${createHash('sha256').update(reviewBytes).digest('hex')}.js`;
let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(baseURL!); });
test.afterAll(async () => { await site.close(); });

// Chromium checks cross-site embeds; the other engines use another loopback port.
const reviewOrigin = (testInfo: TestInfo) => testInfo.project.name.includes('Chrome') ? site.origin() : site.loopbackOrigin;

test('ordinary visitors download only the bootstrap; a review link loads the review script @smoke', async ({ page, browser, baseURL }, testInfo) => {
    const origin = reviewOrigin(testInfo);
    await signIn(page, uniqueEmail('lazy-toolbar'));
    const project = await createProject(page, { urls: [origin] });
    const guest = await newVisitor(browser, testInfo);
    const assets: string[] = [];
    guest.page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/toolbar/') || url.pathname.startsWith('/toolbar-fonts/')) assets.push(url.pathname);
    });
    try {
        const checked = guest.page.waitForResponse(response => response.url().endsWith(`/api/review/${project}/sso`));
        await guest.page.goto(`${origin}/${project}/pricing`);
        expect((await checked).status()).toBe(204);
        await expect(guest.page.locator('iframe[title="uier background sign-in"]')).toHaveCount(0);
        await expect(toolbar(guest.page)).toHaveCount(0);
        expect(assets).toEqual([]);
        await guest.page.goto(`${origin}/${project}/pricing?review=true`);
        await expect(toolbar(guest.page)).toBeVisible();
        expect(assets.filter(path => path.startsWith('/toolbar/'))).toEqual([reviewPath]);
        // The default invited-only project still shows the same sign-in notice.
        await expect(toolbar(guest.page)).toContainText('Sign in to see and leave comments.');
        const runtime = await guest.context.request.get(new URL(reviewPath, baseURL).href);
        expect(runtime.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
        expect(runtime.headers()['access-control-allow-origin']).toBe('*');
        expect((await runtime.body()).equals(reviewBytes)).toBe(true);
    } finally { await guest.context.close(); }
});

test('concurrent embeds share one review download and retain the first script configuration', async ({ page, baseURL }) => {
    // Keep a real loopback origin: Chromium blocks loopback scripts from about:blank.
    await page.goto(`${site.origin('missing-script')}/bootstrap-fixture`);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let requests = 0;
    await page.route(`**${reviewPath}`, async route => {
        requests++;
        await held;
        await route.continue();
    });
    await page.evaluate(async src => {
        window.uierConfig = { mode: 'showcase', apiUrl: new URL(src).origin };
        const add = () => new Promise<void>(resolve => {
            const script = document.createElement('script');
            script.src = src;
            script.nonce = 'bootstrap-nonce';
            script.onload = () => resolve();
            document.head.appendChild(script);
        });
        await Promise.all([add(), add()]);
        window.uierConfig = { mode: 'review', apiUrl: 'https://wrong-api.example', project: 'zzzzzzzzzzzz' };
    }, new URL('/toolbar.js', baseURL).href);
    await expect.poll(() => requests).toBe(1);
    const loading = page.locator(`script[src$="${reviewPath}"]`);
    expect(await loading.evaluate(script => (script as HTMLScriptElement).nonce)).toBe('bootstrap-nonce');
    await expect(loading).toHaveAttribute('integrity', `sha384-${createHash('sha384').update(reviewBytes).digest('base64')}`);
    release();
    await expect(toolbar(page)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open install guide' })).toHaveAttribute('href', `${new URL(baseURL!).origin}/app/projects`);
    expect(requests).toBe(1);
});

test('feedback retries a failed review download and reopens without downloading it again', async ({ page, baseURL }) => {
    await page.goto('/app/sign-in');
    let requests = 0;
    await page.route(`**${reviewPath}`, async route => {
        requests++;
        if (requests === 1) await route.abort();
        else await route.continue();
    });
    await page.evaluate(async src => {
        const script = document.createElement('script');
        script.src = src;
        script.dataset.uierMode = 'feedback';
        await new Promise<void>(resolve => {
            script.onload = () => resolve();
            document.head.appendChild(script);
        });
    }, new URL('/toolbar.js', baseURL).href);
    await expect.poll(() => requests).toBe(1);
    await expect(page.locator(`script[src$="${reviewPath}"]`)).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event('uier:open-feedback')));
    await expect(toolbar(page)).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Feedback', exact: true })).toBeVisible();
    expect(requests).toBe(2);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Options', exact: true }).click();
    await page.getByRole('button', { name: 'Close toolbar', exact: true }).click();
    await expect(toolbar(page)).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event('uier:open-feedback')));
    await expect(toolbar(page)).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Feedback', exact: true })).toBeVisible();
    expect(requests).toBe(2);
});

test('review activation preserves in-memory identity when host storage is blocked', async ({ page, baseURL }, testInfo) => {
    const origin = reviewOrigin(testInfo);
    await signIn(page, uniqueEmail('lazy-storage'));
    const project = await createProject(page, { urls: [origin] });
    await page.addInitScript(origin => {
        if (location.origin !== origin) return;
        for (const method of ['getItem', 'setItem', 'removeItem']) {
            Object.defineProperty(Storage.prototype, method, { value() { throw new Error('Storage blocked'); } });
        }
    }, origin);
    let bridges = 0;
    const memberChecks: Record<string, string>[] = [];
    page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (path === '/review-session') bridges++;
        if (path === `/api/review/${project}` && request.method() === 'GET') memberChecks.push(request.headers());
    });
    const checked = page.waitForResponse(response => response.url().endsWith(`/api/review/${project}/sso`));
    await page.goto(`${origin}/${project}/pricing`);
    const status = (await checked).status();
    if (status === 204) {
        // WebKit refuses the Secure SSO cookie on this HTTP fixture. Exercise the real
        // authenticated review-link fallback without weakening browser cookie protection.
        await expect(page.locator('iframe[title="uier background sign-in"]')).toHaveCount(0);
        await expect(toolbar(page)).toHaveCount(0);
        expect(memberChecks).toEqual([]);
        await page.goto(new URL(`/app/review/${project}?url=${encodeURIComponent(`${origin}/${project}/pricing`)}`, baseURL).href);
    } else {
        expect(status).toBe(200);
    }
    await expect(page.getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
    expect(bridges).toBe(1);
    expect(memberChecks[0]?.authorization).toMatch(/^Bearer /);
    if (status === 200) expect(memberChecks[0]?.['x-uier-visitor']).toBeUndefined();
});
