import { expect, test } from '@playwright/test';
import { createProject, hydrated, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { projectPagingJourney } from './support/projectPaging';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

test('project columns page on scroll, virtualize, keep totals and load full details only when opened', async ({ page, request }, testInfo) => {
    await projectPagingJourney(page, request, testInfo, site.origin());
});

// While a column or the list loads its next page, outlines of that page's first items stand in above Load more
// (docs/design/loading-states, item 24): for a next page only, never while the loaded window is read again.
test('the next page is outlined above Load more while it loads, and only then', async ({ page, request }) => {
    test.setTimeout(90_000);
    await signIn(page, uniqueEmail('next-page-outline'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    // A first page of 25 and two more threads
    let headers = await verifiedReviewHeaders(request, project, site.origin());
    for (let index = 0; index < 27; index++) {
        if (index && index % 10 === 0) headers = await verifiedReviewHeaders(request, project, site.origin());
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: `/${project}/pricing`, text: `Outlined feedback ${index}`, authorName: 'Paging reviewer', position: { type: 'page' }, kind: 'feedback'
        } });
        expect(response.status(), await response.text()).toBe(201);
    }
    await page.goto(`/app/projects/${project}?view=board`);
    await hydrated(page.getByRole('button', { name: 'Board', exact: true }));
    const column = page.getByRole('region', { name: 'Open comments', exact: true });
    const cards = column.locator('[data-comment-window]');
    await expect(cards).toHaveAttribute('data-loaded-count', '25');

    // Requests for comment pages wait while `holding`, until they are let through
    let holding = false;
    const waiting: (() => void)[] = [];
    await page.route(`**/api/projects/${project}/comments/pages`, async route => {
        if (holding) await new Promise<void>(resolve => waiting.push(resolve));
        await route.continue();
    });
    const held = () => expect.poll(() => waiting.length).toBeGreaterThan(0);
    const letThrough = () => { holding = false; for (const resolve of waiting.splice(0)) resolve(); };
    const more = column.getByRole('button', { name: 'Load more', exact: true });
    const outline = cards.locator('[data-next-page]');

    // A search reads the loaded window again: the column is busy and Load more waits, but no more rows are on their way
    holding = true;
    await page.getByRole('searchbox', { name: 'Search feedback' }).fill('Outlined');
    await held();
    await expect(more).toBeDisabled();
    await expect(outline).toHaveCount(0);
    letThrough();
    await expect(more).toBeEnabled();
    await expect(cards).toHaveAttribute('data-loaded-count', '25');

    // Its next page: two cards' outlines above the waiting button, pulsing, and no items of the list
    holding = true;
    await cards.evaluate(element => element.lastElementChild?.scrollIntoView({ block: 'end' }));
    await held();
    await expect(outline).toBeVisible();
    await expect(outline).toHaveAttribute('role', 'presentation');
    await expect(outline).toHaveAttribute('aria-hidden', 'true');
    await expect(outline.locator(':scope > *')).toHaveCount(2);
    await expect(outline.locator('[data-slot=skeleton]').first()).not.toHaveCSS('animation-name', 'none');
    await expect(more).toBeDisabled();
    expect((await outline.boundingBox())!.y).toBeLessThan((await more.boundingBox())!.y);
    letThrough();
    await expect(cards).toHaveAttribute('data-loaded-count', '27');
    await expect(outline).toHaveCount(0);

    // The list outlines rows, as many as remain (two, not its three), still with reduced motion
    await page.getByRole('button', { name: 'List', exact: true }).click();
    const list = page.locator('[data-comment-window]').filter({ visible: true });
    await expect(list).toHaveAttribute('data-loaded-count', '25');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    holding = true;
    // Narrow lists follow the document, desktop lists scroll themselves
    await list.evaluate(element => {
        if (matchMedia('(max-width: 1023px)').matches) globalThis.scrollTo(0, globalThis.scrollY + element.getBoundingClientRect().bottom - innerHeight);
        else element.scrollTop = element.scrollHeight;
    });
    await held();
    const rows = list.locator('[data-next-page]');
    await expect(rows.locator(':scope > *')).toHaveCount(2);
    await expect(rows.locator('[data-slot=skeleton]').first()).toHaveCSS('animation-name', 'none');
    letThrough();
    await expect(list).toHaveAttribute('data-loaded-count', '27');
    await expect(rows).toHaveCount(0);
});
