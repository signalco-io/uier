import { expect, test, type Page, type Request } from '@playwright/test';
import { filterPageChecks } from '../src/lib/pageChecks/insights';
import type { PageCheckRow } from '../src/lib/pageChecks/model';
import { expectNoAxeViolations } from './accessibility';
import { createProject, signIn, uniqueEmail } from './support/app';
import { auditRuns, observeAuditRuns } from './support/auditRuns';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished, toolbar } from './support/toolbar';

// The site view of the page checks (packages/toolbar/docs/page-checks-site.md, apps/web/docs/page-checks.md):
// a member's toolbar saves each reviewed page's summary in the background, and the project's Page checks
// view in the app lists the pages with their counts and what only shows across pages.

test.use({ actionTimeout: 15_000 });

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

/** The next page summary the toolbar sends */
function nextSummary(page: Page, project: string) {
    return page.waitForRequest((request: Request) => request.method() === 'POST' && new URL(request.url()).pathname === `/api/review/${project}/page-checks`,
        { timeout: 45_000 });
}

type Summary = {
    path: string;
    title?: string;
    description?: string;
    noindex: boolean;
    accessibility?: Record<'critical' | 'serious' | 'moderate' | 'minor', number>;
    seo: { warn: number; pass: number };
    checks: Record<string, string>;
    vitals?: Record<string, number>;
};

test('a member reviews two pages with the same title, and the project\'s Page checks list both with their counts and the shared title', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(150_000);
    await signIn(page, uniqueEmail('page-checks-site'));
    const origin = site.origin('fixture-site');
    const project = await createProject(page, { urls: [origin] });

    // Before any review, the view says how pages get here
    await page.goto(`/app/projects/${project}/page-checks`);
    await expect(page.getByRole('navigation', { name: 'Project' }).getByRole('link', { name: 'Page checks' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('No pages checked yet')).toBeVisible();
    await expect(page.getByText('Pages appear here as project members review the site with the toolbar.')).toBeVisible();

    // The first page: checked in the background, then its summary is saved once the reports settle
    const responses: number[] = [];
    page.on('response', response => {
        if (new URL(response.url()).pathname === `/api/review/${project}/page-checks` && response.request().method() === 'POST') responses.push(response.status());
    });
    await observeAuditRuns(page);
    const first = nextSummary(page, project);
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${origin}/${project}/pricing`)}`);
    await expect(toolbar(page)).toBeVisible();
    const pricing = (await first).postDataJSON() as Summary;
    expect(pricing).toMatchObject({ path: `/${project}/pricing`, title: 'Reviewed site', noindex: false,
        description: 'Plans and prices for teams that review their sites with comments on the page.' });
    // Counts, check states and measurements only: no element, page text or reviewer
    expect(Object.keys(pricing).sort()).toEqual(expect.arrayContaining(['accessibility', 'checks', 'noindex', 'path', 'seo']));
    for (const key of Object.keys(pricing)) expect(['path', 'sourcePath', 'title', 'description', 'noindex', 'accessibility', 'seo', 'checks', 'vitals']).toContain(key);
    expect(pricing.accessibility).toEqual({ critical: expect.any(Number), serious: expect.any(Number), moderate: expect.any(Number), minor: expect.any(Number) });
    expect(pricing.seo.pass).toBeGreaterThan(0);
    expect(pricing.checks['seo:title']).toBe('pass');
    for (const key of Object.keys(pricing.checks)) expect(key).toMatch(/^(?:seo|accessibility):[a-z0-9][a-z0-9-]*$/);
    await expect.poll(() => responses).toEqual([204]);

    // The same page again in this browser, unchanged: checked again, but nothing is sent (it would be by now)
    await page.reload();
    await expect(toolbar(page)).toBeVisible();
    await expect.poll(async () => (await auditRuns(page)).length, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(8_000);
    expect(responses).toEqual([204]);

    // A second page of the site, with the same title, in the same review
    const second = nextSummary(page, project);
    await page.goto(`${origin}/${project}/plans`);
    await expect(toolbar(page)).toBeVisible();
    const plans = (await second).postDataJSON() as Summary;
    expect(plans).toMatchObject({ path: `/${project}/plans`, title: 'Reviewed site' });
    await expect.poll(() => responses).toEqual([204, 204]);

    // The app lists both pages with their counts, and the title they share
    await page.goto(`/app/projects/${project}/page-checks`);
    const table = page.locator('[data-page-checks-table]');
    await expect(table).toBeVisible();
    await expect(table.getByRole('row')).toHaveCount(3);
    for (const [path, summary] of [[`/${project}/pricing`, pricing], [`/${project}/plans`, plans]] as const) {
        const row = table.locator(`[data-page-check="${path}"]`);
        await expect(row.getByRole('link', { name: `Open in review: ${path}` })).toHaveAttribute('href',
            `/app/review/${project}?url=${encodeURIComponent(`${origin}${path}`)}`);
        await expect(row).toContainText('Reviewed site');
        // Each impact axe-core found, with its count
        const found = Object.entries(summary.accessibility!).filter(([, count]) => count > 0);
        const accessibility = row.getByRole('cell').nth(1);
        if (!found.length) await expect(accessibility).toHaveText('None found');
        for (const [impact, count] of found) await expect(accessibility).toContainText(`${count} ${impact}`);
        await expect(row.getByRole('cell').nth(2)).toContainText(summary.seo.warn ? `${summary.seo.warn} to look at` : 'None to look at');
        await expect(row.getByRole('cell').nth(2)).toContainText(`${summary.seo.pass} passed`);
        await expect(row.getByRole('cell').nth(4)).toContainText('First check');
    }
    // A measured Core Web Vital shows its target and both states on hover and on keyboard focus (uier #220)
    const measured = (['lcp', 'cls', 'inp'] as const).find(name => pricing.vitals?.[name] !== undefined);
    expect(measured, 'Chrome measures at least one Core Web Vital on the reviewed page').toBeDefined();
    const vital = table.locator(`[data-page-check="/${project}/pricing"] [data-vital="${measured}"]`);
    const targets = page.getByRole('dialog', { name: `${{ lcp: 'Largest Contentful Paint', cls: 'Cumulative Layout Shift', inp: 'Interaction to Next Paint' }[measured!]} (${measured!.toUpperCase()})` });
    await vital.hover();
    await expect(targets.locator('[data-vital-state]')).toHaveCount(2);
    await expect(targets.locator('[data-vital-state="within"]')).toContainText('Within target');
    await expect(targets.locator('[data-vital-state="over"]')).toContainText('Over target');
    await expect(targets.locator('[aria-current="true"]')).toHaveCount(1);
    await page.mouse.move(0, 0);
    await expect(targets).toBeHidden();
    await vital.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(targets).toBeVisible();
    await expect(vital).toBeFocused();
    // Escape closes it, and focus back on the trigger does not open it again
    await page.keyboard.press('Escape');
    await expect(targets).toBeHidden();
    await expect(vital).toBeFocused();
    // Each finding's pages are closed until asked for (uier #219), then listed under their common path
    const sharedTitles = page.getByRole('region', { name: 'Shared titles' });
    await expect(sharedTitles.getByRole('link')).toHaveCount(0);
    await sharedTitles.getByRole('button', { name: 'Show 2 pages' }).click();
    await expect(sharedTitles.getByRole('button', { name: 'Hide pages' })).toHaveAttribute('aria-expanded', 'true');
    await expect(sharedTitles).toContainText('Reviewed site');
    await expect(sharedTitles.getByRole('link')).toHaveText([`Open in review: /${project}/plans`, `Open in review: /${project}/pricing`]);
    // No page at /<project> itself: a level of the addresses, with the two pages under it
    await expect(sharedTitles.locator(`span[title="/${project}"]`)).toHaveText(`/${project}`);
    const sharedDescriptions = page.getByRole('region', { name: 'Shared descriptions' });
    await sharedDescriptions.getByRole('button', { name: 'Show 2 pages' }).click();
    await expect(sharedDescriptions.getByRole('link')).toHaveCount(2);
    await expect(page.getByRole('region', { name: 'Not indexed' })).toContainText('No page asks not to be indexed.');
    await expect(page.getByText('in members’ browsers at the time of each visit')).toBeVisible();

    // Only the pages that need attention (uier #221), kept in the address; the heading says how many of all
    const rows = [pricing, plans].map(summary => ({ ...summary, id: summary.path, origin, checkedAt: '' }) as PageCheckRow);
    const attention = filterPageChecks(rows, 'attention').map(row => row.path);
    await page.getByRole('combobox', { name: 'Show pages' }).click();
    await page.getByRole('option', { name: `Needs attention ${attention.length} pages` }).click();
    await expect(page).toHaveURL(/[?&]show=attention/);
    await expect(page.getByRole('heading', { name: `Pages ${attention.length} of 2` })).toBeVisible();
    if (attention.length) await expect(table.locator('[data-page-check]')).toHaveCount(attention.length);
    else await expect(page.locator('[data-page-checks-filtered]')).toContainText('No checked page has anything to look at.');
    await page.getByRole('combobox', { name: 'Show pages' }).click();
    await page.getByRole('option', { name: /^All pages/ }).click();
    await expect(page).not.toHaveURL(/[?&]show=/);
    await expect(table.locator('[data-page-check]')).toHaveCount(2);

    // Sorted by what needs most attention by default; Page sorts by the address and says so on its column
    await page.getByRole('combobox', { name: 'Sort pages' }).click();
    await page.getByRole('option', { name: 'Page' }).click();
    await expect(page).toHaveURL(/[?&]sort=page/);
    await expect(table.getByRole('columnheader', { name: 'Page' })).toHaveAttribute('aria-sort', 'ascending');
    await expect(table.locator('[data-page-check]').first()).toHaveAttribute('data-page-check', `/${project}/plans`);

    for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await expect(page.locator('html')).toHaveClass(new RegExp(colorScheme));
        await animationsFinished(page.locator('body'));
        await expectNoAxeViolations(page);
        await page.locator('section[aria-labelledby="page-checks-title"]').screenshot({ path: testInfo.outputPath(`page-checks-${colorScheme}.png`) });
    }
});

test('on a narrow screen each page is a card', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile !== true, 'The phone layout');
    test.setTimeout(150_000);
    await signIn(page, uniqueEmail('page-checks-site-phone'));
    const origin = site.origin('fixture-site');
    const project = await createProject(page, { urls: [origin] });
    // Saved before the page is left (leaving it would cancel the request)
    const saved = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/review/${project}/page-checks`,
        { timeout: 45_000 });
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${origin}/${project}/private`)}`);
    await expect(toolbar(page)).toBeVisible();
    const response = await saved;
    expect(response.status()).toBe(204);
    expect((response.request().postDataJSON() as Summary).noindex).toBe(true);

    await page.goto(`/app/projects/${project}/page-checks`);
    await expect(page.locator('[data-page-checks-table]')).toBeHidden();
    const card = page.locator(`li[data-page-check="/${project}/private"]`);
    await expect(card.getByRole('link', { name: `Open in review: /${project}/private` })).toBeVisible();
    await expect(card).toContainText('Accessibility');
    await expect(card).toContainText('Checked');
    // A tap shows a measured Core Web Vital's target and states (uier #220)
    await card.locator('[data-vital]').first().tap();
    await expect(page.getByRole('dialog').locator('[data-vital-state]')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    const notIndexed = page.getByRole('region', { name: 'Not indexed' });
    await notIndexed.getByRole('button', { name: 'Show the page' }).click();
    await expect(notIndexed.getByRole('link')).toHaveText(new RegExp(`/${project}/private`));
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await expectNoAxeViolations(page);
    await page.locator('section[aria-labelledby="page-checks-title"]').screenshot({ path: testInfo.outputPath('page-checks-phone.png') });
});

test('on a wide window the view and the project header take the width, like the comments', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop windows');
    // The window the feedback came from (uier #214)
    await page.setViewportSize({ width: 1674, height: 1366 });
    await signIn(page, uniqueEmail('page-checks-site-wide'));
    const project = await createProject(page, { urls: [site.origin('fixture-site')] });
    await page.goto(`/app/projects/${project}/page-checks`);
    await expect(page.getByText('No pages checked yet')).toBeVisible();
    const box = async (locator: ReturnType<Page['locator']>) => {
        const found = (await locator.boundingBox())!;
        return { left: found.x, right: found.x + found.width, width: found.width };
    };
    const view = await box(page.locator('section[aria-labelledby="page-checks-title"]'));
    // Wider than the reading column (64rem less the 32 px gutters), at most 96rem
    expect(view.width).toBeGreaterThan(1024 - 64);
    expect(view.width).toBeLessThanOrEqual(1536);
    // The project header spans it: its mark starts with the view, the settings button ends with it
    const mark = await box(page.getByRole('heading', { level: 1 }).locator('xpath=../../*[1]'));
    const settings = await box(page.getByRole('main').getByLabel('Settings', { exact: true }));
    expect(mark.left).toBeCloseTo(view.left, 0);
    expect(settings.right).toBeCloseTo(view.right, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1674);
});


test('Across pages links checked ancestors in the same environment outside the finding (uier #254)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Address hierarchy');
    test.setTimeout(90_000);
    await signIn(page, uniqueEmail('checked-ancestors'));
    const origin = site.origin('fixture-site');
    const other = site.origin();
    const project = await createProject(page, { urls: [origin, other] });
    const session = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/review/${project}/session`);
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${origin}/${project}/seed`)}`);
    const { token: reviewToken } = await (await session).json() as { token: string };
    const authorization = `Bearer ${reviewToken}`;
    for (const [address, path, title] of [
        [origin, '/cms', 'CMS home'],
        [origin, '/cms/products', 'Products'],
        [origin, '/cms/products/a', 'Shared title'],
        [origin, '/cms/products/b', 'Shared title'],
        [origin, '/cms/users/a', 'Shared title'],
        [origin, '/cms/users/b', 'Shared title'],
        [other, '/cms/users', 'Other environment']
    ]) {
        const verification = await page.request.post(`/api/review/${project}/verification`, {
            headers: { Authorization: authorization }, data: { origin: address }
        });
        expect(verification.status()).toBe(200);
        const { token } = await verification.json() as { token: string };
        const response = await page.request.post(`/api/review/${project}/page-checks`, {
            headers: { Origin: address!, Authorization: authorization, 'X-Uier-Verification': token },
            data: { path, title, noindex: false, seo: { pass: 1, warn: 0 }, checks: {} }
        });
        expect(response.status()).toBe(204);
    }
    await page.goto(`/app/projects/${project}/page-checks`);
    const titles = page.getByRole('region', { name: 'Shared titles' });
    await titles.getByRole('button', { name: 'Show 4 pages' }).click();
    for (const path of ['/cms', '/cms/products', '/cms/products/a', '/cms/products/b']) {
        const href = `/app/review/${project}?url=${encodeURIComponent(`${origin}${path}`)}`;
        await expect(titles.locator(`a[href="${href}"]`)).toBeVisible();
    }
    // A checked page in another environment never turns this grouping into a link.
    await expect(titles.getByRole('link', { name: /^Open in review: \/cms\s*\/users$/ })).toHaveCount(0);
    await expect(titles.locator('span[title="/cms/users"]')).toHaveText('/users');
});
