import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished, showChecksTab, toolbar } from './support/toolbar';

// The SEO panel's Sharing and Structured data sections (packages/toolbar/docs/page-checks-seo-head.md)
// on a project's site on another origin with the install guide's CSP: `fixture-seo-head`
// (e2e/support/fixtures/seoHead.ts) serves a page with complete tags, one with broken ones, a small
// image, an image the CSP blocks and a noindex page.

test.use({ actionTimeout: 15_000 });

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

const origin = () => site.origin('fixture-seo-head');

/** A member reviews the fixture's page through the app's review link; later pages of the tab keep the review */
async function memberReview(page: Page, label: string, variant: string) {
    await signIn(page, uniqueEmail(label));
    const project = await createProject(page, { urls: [origin()] });
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${origin()}/${project}/${variant}`)}`);
    await expect(toolbar(page)).toBeVisible();
    return project;
}

/** Opens the SEO panel and waits for both sections, the shared image measured */
async function openSeoPanel(page: Page) {
    await toolbar(page).getByRole('button', { name: /^SEO/ }).click();
    const panel = page.getByRole('complementary', { name: 'SEO' });
    const sharing = panel.locator('[data-uier-section="sharing"]');
    await expect(sharing).toHaveAttribute('data-uier-section-status', 'done', { timeout: 20_000 });
    await expect(panel.locator('[data-uier-section="structuredData"]')).toHaveAttribute('data-uier-section-status', 'done');
    await expect(sharing).not.toContainText('Loading the image...', { timeout: 15_000 });
    await showChecksTab(panel, 'sharing');
    return panel;
}

const row = (panel: Locator, id: string) => panel.locator(`[data-uier-check="${id}"]`);

async function expectRow(panel: Locator, id: string, state: 'pass' | 'warn' | 'none', text?: string | RegExp) {
    await expect(row(panel, id)).toHaveAttribute('data-uier-check-state', state);
    if (text) await expect(row(panel, id)).toContainText(text);
}

test('the Sharing and Structured data sections pass a page with complete tags and show its previews', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(90_000);
    await memberReview(page, 'seo-head-complete', 'complete');
    const panel = await openSeoPanel(page);

    await expectRow(panel, 'share-title', 'pass', 'Plans for review teams');
    await expectRow(panel, 'share-description', 'pass', 'From og:description.');
    await expectRow(panel, 'share-image', 'pass', 'A full address, described by og:image:alt.');
    // Loaded in the browser and measured
    await expectRow(panel, 'share-image-size', 'pass', '1200 × 630');
    await expectRow(panel, 'share-url', 'pass', 'Matches the canonical link.');
    await expectRow(panel, 'share-x-card', 'pass', 'A large image card.');

    // The previews: neutral cards with the page's own words, captioned as an illustration
    const search = panel.locator('[data-uier-preview="search"]');
    await expect(search).toContainText('About how a search result looks');
    await expect(search).toContainText('Reviewed site');
    await expect(search).toContainText('Plans and prices for teams that review live websites');
    const card = panel.locator('[data-uier-preview="card"]');
    await expect(card).toContainText('About how a shared link looks');
    await expect(card).toContainText('Plans for review teams');
    await expect(card).toContainText('Every plan includes the toolbar and comments pinned to the page.');
    const image = card.locator('img');
    await expect(image).toHaveAttribute('src', `${origin()}/share/card.png`);
    await expect(image).toHaveAttribute('alt', '');
    await expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect(image).toHaveAttribute('loading', 'lazy');
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBe(1200);

    // JSON-LD in a @graph: the top items' types, each common type checked against its documentation
    await expectRow(panel, 'schema-found', 'pass', '3 items in 1 JSON-LD block.');
    await expect(row(panel, 'schema-found')).toContainText('WebSite, Article, BreadcrumbList');
    await expectRow(panel, 'schema-parse', 'pass', 'Every block is valid JSON.');
    await expectRow(panel, 'schema-article', 'pass', 'Has what Google\'s article documentation recommends.');
    await expectRow(panel, 'schema-breadcrumblist', 'pass');
    await expectRow(panel, 'schema-website', 'pass');
    await expect(panel.locator('[data-uier-section="sharing"] [data-uier-check-state="warn"]')).toHaveCount(0);
    await expect(panel.locator('[data-uier-section="structuredData"] [data-uier-check-state="warn"]')).toHaveCount(0);

    await animationsFinished(panel);
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });
});

/** The next comment the toolbar posts, with its body */
function nextCreate(page: Page, project: string) {
    return page.waitForRequest((request: Request) => request.method() === 'POST' && new URL(request.url()).pathname === `/api/review/${project}/comments`);
}

test('the sections report broken sharing tags and structured data, count them and post one as a comment', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(90_000);
    const project = await memberReview(page, 'seo-head-broken', 'broken');
    // The tags and JSON-LD are read in the background: the page's own SEO checks find nothing here
    const button = toolbar(page).getByRole('button', { name: /^SEO/ });
    await expect(button).toHaveAccessibleName(/^SEO, \d+ to look at$/, { timeout: 20_000 });
    const panel = await openSeoPanel(page);

    await expectRow(panel, 'share-title', 'warn', '2 og:title tags. Platforms may use either.');
    await expectRow(panel, 'share-description', 'none', 'No og:description. The meta description is the usual fallback.');
    await expectRow(panel, 'share-image', 'warn', 'A relative address.');
    await expectRow(panel, 'share-image-size', 'warn', 'The image did not load in this browser.');
    await expectRow(panel, 'share-url', 'warn', 'Differs from the canonical link.');
    await expectRow(panel, 'share-x-card', 'warn', 'Not a card type X documents');
    // The card says the image did not load here (a lazy image: in view, it loads)
    await panel.locator('[data-uier-preview="card"]').scrollIntoViewIfNeeded();
    await expect(panel.locator('[data-uier-preview="card"]')).toContainText('Image not shown here');

    await expectRow(panel, 'schema-found', 'pass', '2 items in 3 JSON-LD blocks.');
    await expectRow(panel, 'schema-parse', 'warn', /Block 1 is not valid JSON: .+/);
    await expectRow(panel, 'schema-article', 'none', 'Block 2 has no headline, no image and no datePublished. Google\'s article documentation recommends them.');
    await expectRow(panel, 'schema-product', 'warn', 'Block 3 has no offers, review or aggregateRating. Google\'s product snippet documentation requires one of them.');
    await expectRow(panel, 'schema-microdata', 'none', '1 microdata item. Counted, not checked.');
    await expect(row(panel, 'schema-microdata')).toContainText('Organization');

    // The summary and the button count the sections' warnings with the panel's own
    const warnings = await panel.locator('[data-uier-check-state="warn"]').count();
    await expect(panel.locator('[data-uier-summary="warn"] [data-uier-summary-count]')).toHaveText(String(warnings));
    await expect(button).toHaveAccessibleName(`SEO, ${warnings} to look at`);

    // A finding about the page names the block and the property, and the documentation it comes from
    const created = nextCreate(page, project);
    await showChecksTab(panel, 'search');
    await row(panel, 'schema-product').getByRole('button', { name: 'Comment' }).click();
    const body = (await created).postDataJSON();
    expect(body.text).toBe('SEO: The Product in the page\'s structured data (JSON-LD block 3) has no offers, review or aggregateRating. '
        + 'Google\'s product snippet documentation requires one of them. https://developers.google.com/search/docs/appearance/structured-data/product-snippet'
        + '\nName: `Team plan`');
    expect(body.check).toEqual({ type: 'seo', id: 'schema-product-3-1' });
    expect(body.position).toMatchObject({ type: 'page' });
    await expect(row(panel, 'schema-product')).toContainText(/(Comment posted|Bug report sent) as #1/);

    await animationsFinished(panel);
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });
});

test('a small image is measured, an image the CSP blocks is a note, and a noindex page needs no sharing tags', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(90_000);
    const project = await memberReview(page, 'seo-head-variants', 'small');
    let panel = await openSeoPanel(page);
    await expectRow(panel, 'share-image', 'pass', 'No og:image:alt describes it.');
    await expectRow(panel, 'share-image-size', 'warn', 'Under 200 × 200 px, the smallest image Facebook\'s sharing guide allows.');
    await expect(row(panel, 'share-image-size')).toContainText('120 × 120');
    await expectRow(panel, 'share-title', 'pass');
    await expectRow(panel, 'share-x-card', 'none', 'No twitter:card. X documents that it may then show a summary card from the Open Graph tags.');
    await expectRow(panel, 'schema-found', 'none', 'No structured data. Not every page needs it.');

    // Not every site lets its own pages load images from another origin: not checked, not a warning
    await page.goto(`${origin()}/${project}/blocked`);
    panel = await openSeoPanel(page);
    await expectRow(panel, 'share-image', 'pass');
    await expectRow(panel, 'share-image-size', 'none', 'Not checked: the page\'s Content-Security-Policy blocks images from that address here.');
    await panel.locator('[data-uier-preview="card"]').scrollIntoViewIfNeeded();
    await expect(panel.locator('[data-uier-preview="card"]')).toContainText('Image not shown here');

    // Missing sharing tags on a page that asks not to be indexed are notes
    await page.goto(`${origin()}/${project}/noindex`);
    panel = await openSeoPanel(page);
    await expectRow(panel, 'share-image', 'none', 'No og:image.');
    await expectRow(panel, 'share-title', 'none', 'No og:title. The page title is the usual fallback.');
    await expect(row(panel, 'share-image-size')).toHaveCount(0);
    await expect(panel.locator('[data-uier-section="sharing"] [data-uier-check-state="warn"]')).toHaveCount(0);
});

test('on a phone the previews fit the panel', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.use.isMobile, 'Phone layout');
    test.setTimeout(90_000);
    await memberReview(page, 'seo-head-mobile', 'complete');
    // The panels are in Options here
    await toolbar(page).getByRole('button', { name: 'Options', exact: true }).tap();
    await page.getByRole('dialog', { name: 'Options' }).getByRole('button', { name: /^SEO/ }).tap();
    const panel = page.getByRole('complementary', { name: 'SEO' });
    await expect(panel.locator('[data-uier-section="sharing"]')).toHaveAttribute('data-uier-section-status', 'done', { timeout: 20_000 });
    await showChecksTab(panel, 'sharing');
    await expectRow(panel, 'share-image-size', 'pass', '1200 × 630');
    const card = panel.locator('[data-uier-preview="card"]');
    await card.scrollIntoViewIfNeeded();
    const viewport = page.viewportSize()!;
    for (const preview of [panel.locator('[data-uier-preview="search"]'), card]) {
        const box = (await preview.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    }
    await expect.poll(() => card.locator('img').evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBe(1200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await animationsFinished(panel);
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });
});
