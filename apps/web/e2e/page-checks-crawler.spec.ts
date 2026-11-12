import { expect, test, type Page, type Request } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, signIn, uniqueEmail } from './support/app';
import { auditAssetPath } from './support/auditRuns';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished, openPageCheck, pageChecksButton, showChecksTab, toolbar } from './support/toolbar';

// The SEO panel's Crawlers section (packages/toolbar/docs/page-checks-crawler.md) on a project's site
// on another origin with the install guide's CSP (`fixture-crawler`, e2e/support/fixtures/crawler.ts):
// what a request without cookies gets from the page, robots.txt for search and AI crawlers, the
// sitemap and llms.txt. Its requests start with the SEO panel, never in the background.

test.use({ actionTimeout: 15_000 });

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

const origin = () => site.origin('fixture-crawler');
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The next comment the toolbar posts, with its body */
function nextCreate(page: Page, project: string) {
    return page.waitForRequest((request: Request) => request.method() === 'POST' && new URL(request.url()).pathname === `/api/review/${project}/comments`);
}

/** The requests the page's scripts (the toolbar) send to the reviewed site, by path: never its navigations or subresources */
function siteRequests(page: Page) {
    const paths: string[] = [];
    page.on('request', request => {
        const url = new URL(request.url());
        if (url.origin === origin() && request.resourceType() === 'fetch') paths.push(url.pathname);
    });
    return { count: (path: string) => paths.filter(item => item === path).length, total: () => paths.length };
}

/** A member reviews a page of the site through the app's review link */
async function memberReview(page: Page, label: string, pagePath: string) {
    await signIn(page, uniqueEmail(label));
    const project = await createProject(page, { urls: [origin()] });
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${origin()}/${project}/${pagePath}`)}`);
    await expect(toolbar(page)).toBeVisible();
    return project;
}

/** Opens the SEO panel and waits for its Crawlers section's report */
async function openCrawlers(page: Page) {
    await openPageCheck(page, /^SEO/);
    const panel = page.getByRole('complementary', { name: 'SEO' });
    const section = panel.locator('[data-uier-section="crawler"]');
    await expect(section).toHaveAttribute('data-uier-section-status', 'done', { timeout: 20_000 });
    await showChecksTab(panel, 'search');
    return { panel, section, check: (id: string) => section.locator(`[data-uier-check="${id}"]`) };
}

test('the Crawlers section requests nothing before the SEO panel opens, then reports the response, robots.txt, the sitemap and llms.txt', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(90_000);
    const requests = siteRequests(page);
    const audit = await auditAssetPath();
    const auditLoaded = page.waitForResponse(response => new URL(response.url()).pathname === audit, { timeout: 30_000 });
    const project = await memberReview(page, 'crawler-section', 'listed');

    // The background checks ran (the SEO button says what they found, the audit asset with the on-demand checks loaded) without a request of the section
    await expect(pageChecksButton(page)).toHaveAttribute('data-uier-attention-panels', /\bseo\b/, { timeout: 20_000 });
    await auditLoaded;
    await page.waitForTimeout(1000);
    expect(requests.total()).toBe(0);

    const { panel, section, check } = await openCrawlers(page);
    await expect(section.getByRole('heading', { name: 'Crawlers' })).toBeVisible();
    await expect(section).toContainText('Requested without cookies');
    await expect(check('crawl-status')).toHaveAttribute('data-uier-check-state', 'pass');
    await expect(check('crawl-status')).toContainText('200');
    await expect(check('crawl-status')).toContainText('The server sends the page to a request without cookies.');
    await expect(check('crawl-x-robots-tag')).toHaveAttribute('data-uier-check-state', 'pass');
    await expect(check('crawl-x-robots-tag')).toContainText('Not sent: the response adds no indexing rules.');
    await expect(check('crawl-robots')).toHaveAttribute('data-uier-check-state', 'pass');
    await expect(check('crawl-robots')).toContainText('Googlebot, Bingbot and other crawlers may read this page.');
    // Blocking AI crawlers is the owner's choice: a note that says who
    await expect(check('crawl-robots-ai')).toHaveAttribute('data-uier-check-state', 'none');
    await expect(check('crawl-robots-ai')).toContainText('Blocked: GPTBot, CCBot');
    await expect(check('crawl-robots-ai')).toContainText('11 of 13 AI crawlers checked may read this page. Blocking them is the site owner\'s choice.');
    // Listed with a trailing slash, in the index's first sitemap
    await expect(check('crawl-sitemap')).toHaveAttribute('data-uier-check-state', 'pass');
    await expect(check('crawl-sitemap')).toContainText('Listed in /sitemaps/pages.xml.');
    // The server sends what the page shows
    await expect(check('crawl-served-h1')).toHaveAttribute('data-uier-check-state', 'pass');
    await expect(check('crawl-served-h1')).toContainText('Pricing for listed');
    await expect(check('crawl-served-text')).toHaveAttribute('data-uier-check-state', 'pass');
    await expect(check('crawl-served-text')).toContainText('The server sends 100% of the page\'s text.');
    await expect(check('crawl-served-head')).toHaveAttribute('data-uier-check-state', 'pass');
    await expect(check('crawl-served-head')).toContainText('The served HTML has the page\'s title.');
    await expect(check('crawl-served-links')).toContainText('No links on the page.');
    await expect(check('crawl-llms')).toHaveAttribute('data-uier-check-state', 'none');
    await expect(check('crawl-llms')).toContainText('Found, and it links this page. No search engine confirms using it.');
    await expect(check('crawl-llms')).toContainText('Reviewed site');
    // The page once, each file once, and the sitemaps until the page was found
    expect([`/${project}/listed`, '/robots.txt', '/llms.txt', '/sitemap.xml', '/sitemaps/pages.xml', '/sitemaps/posts.xml'].map(requests.count))
        .toEqual([1, 1, 1, 1, 1, 0]);

    // Each AI crawler, folded under its row: what it is for and the rule that applies
    await check('crawl-robots-ai').locator('summary', { hasText: 'Each AI crawler' }).click();
    const crawlers = check('crawl-robots-ai').getByRole('list', { name: 'AI crawlers' });
    await expect(crawlers.getByRole('listitem')).toHaveCount(13);
    await expect(crawlers.locator('[data-uier-crawler="GPTBot"]')).toContainText('OpenAI, training AI models');
    await expect(crawlers.locator('[data-uier-crawler="GPTBot"]')).toContainText('Blocked by Disallow: /');
    await expect(crawlers.locator('[data-uier-crawler="ClaudeBot"]')).toContainText('Allowed');

    await animationsFinished(panel);
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });

    // Kept for the page: opening the panel again requests nothing
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await openPageCheck(page, /^SEO/);
    await expect(check('crawl-sitemap')).toHaveAttribute('data-uier-check-state', 'pass');
    expect(requests.total()).toBe(5);

    // Another page of the site (a client-side navigation, the panel stays open): robots.txt and
    // llms.txt are kept, the sitemaps are read on from where they stopped, in full this time
    await page.evaluate(() => history.pushState({}, '', location.pathname.replace(/listed$/, 'unlisted')));
    await expect(check('crawl-sitemap')).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(check('crawl-sitemap')).toContainText(/Not listed in 3 sitemap files \([\d,]+ addresses\)\./);
    expect([`/${project}/unlisted`, '/robots.txt', '/llms.txt', '/sitemap.xml', '/sitemaps/pages.xml', '/sitemaps/posts.xml'].map(requests.count))
        .toEqual([1, 1, 1, 1, 1, 1]);
    await expect(check('crawl-llms')).toContainText('Found; it does not link this page.');

    // Its comment says what was read
    const created = nextCreate(page, project);
    await check('crawl-sitemap').getByRole('button', { name: 'Comment' }).click();
    const body = (await created).postDataJSON();
    expect(body.check).toEqual({ type: 'seo', id: 'crawl-sitemap' });
    expect(body.position).toMatchObject({ type: 'page' });
    expect(body.text).toMatch(new RegExp(`^${escaped(`SEO: This page is not listed in the site's sitemap, read in full.
Page: \`${origin()}/${project}/unlisted\`
Sitemap: \`${origin()}/sitemap.xml: a sitemap index of 2 sitemaps\`
Sitemap: \`${origin()}/sitemaps/pages.xml: `)}\\d+ address(?:es)?\`\n${escaped(`Sitemap: \`${origin()}/sitemaps/posts.xml: 1 address\``)}$`));
    expect(body.text.length).toBeLessThanOrEqual(1000);
    await expect(check('crawl-sitemap')).toContainText(/(?:sent|posted) as #1/);

    // Check again requests the site's files again
    await panel.getByRole('button', { name: 'Check again' }).click();
    await expect.poll(() => requests.count('/robots.txt')).toBe(2);
    await expect(section).toHaveAttribute('data-uier-section-status', 'done');
    await expect(check('crawl-sitemap')).toHaveAttribute('data-uier-check-state', 'warn');
    expect(requests.count(`/${project}/unlisted`)).toBe(2);
});

test('the Crawlers section compares the served HTML, reads X-Robots-Tag and robots.txt, and says what a sign-in or an error returns', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(120_000);
    const project = await memberReview(page, 'crawler-served', 'script');

    // The h1, most of the text, the links and the meta description are added by a script
    let { check } = await openCrawlers(page);
    await expect(check('crawl-served-h1')).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(check('crawl-served-h1')).toContainText('The h1 is added by JavaScript. Crawlers that do not run JavaScript get only the served HTML.');
    await expect(check('crawl-served-h1')).toContainText('Plans rendered in the browser');
    await expect(check('crawl-served-text')).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(check('crawl-served-text')).toContainText(/The server sends \d+% of the page's text\. The rest is added by JavaScript\./);
    await expect(check('crawl-served-head')).toHaveAttribute('data-uier-check-state', 'none');
    await expect(check('crawl-served-head')).toContainText('The meta description is added by JavaScript.');
    await expect(check('crawl-served-links')).toHaveAttribute('data-uier-check-state', 'none');
    await expect(check('crawl-served-links')).toContainText('The server sends 0 of the page\'s 3 link addresses.');
    await expect(check('crawl-served-links')).toContainText('0 of 3');
    // The section's warnings count in the panel's summary and its button
    const panel = page.getByRole('complementary', { name: 'SEO' });
    await expect(panel.locator('[data-uier-summary="warn"] [data-uier-summary-count]')).toHaveText(String(await panel.locator('[data-uier-check-state="warn"]').count()));

    // Its comment says what was requested and what came back
    let created = nextCreate(page, project);
    await check('crawl-served-h1').getByRole('button', { name: 'Comment' }).click();
    let body = (await created).postDataJSON();
    expect(body.check).toEqual({ type: 'seo', id: 'crawl-served-h1' });
    expect(body.text).toBe(`SEO: The h1 is added by JavaScript: the HTML the server sends has none. Crawlers that do not run JavaScript get only the served HTML.
Requested without cookies: \`GET ${origin()}/${project}/script\`
Answer: \`200 OK\`
h1 on the page: \`Plans rendered in the browser\``);
    await expect(check('crawl-served-h1')).toContainText(/(?:sent|posted) as #1/);

    // X-Robots-Tag: noindex, while the robots meta tag allows indexing; such a page needs no sitemap listing
    await page.goto(`${origin()}/${project}/noindex`);
    ({ check } = await openCrawlers(page));
    await expect(check('crawl-x-robots-tag')).toHaveAttribute('data-uier-check-state', 'none');
    await expect(check('crawl-x-robots-tag')).toContainText('noindex');
    await expect(check('crawl-x-robots-tag')).toContainText('The response asks search engines not to index the page. The robots meta tag does not.');
    await expect(check('crawl-sitemap')).toHaveAttribute('data-uier-check-state', 'none');
    await expect(check('crawl-sitemap')).toContainText('Not listed in 3 sitemap files. Not needed on a noindex page.');

    // robots.txt blocks search crawlers from an indexable page: worth a look, with the lines that block
    await page.goto(`${origin()}/${project}/drafts`);
    ({ check } = await openCrawlers(page));
    await expect(check('crawl-robots')).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(check('crawl-robots')).toContainText('robots.txt blocks Googlebot, Bingbot and other crawlers from this page.');
    await expect(check('crawl-robots')).toContainText('Disallow: /*/drafts');
    created = nextCreate(page, project);
    await check('crawl-robots').getByRole('button', { name: 'Comment' }).click();
    body = (await created).postDataJSON();
    expect(body.check).toEqual({ type: 'seo', id: 'crawl-robots' });
    expect(body.text).toBe(`SEO: robots.txt blocks Googlebot, Bingbot and other crawlers from this page.
Requested without cookies: \`GET ${origin()}/robots.txt\`
Answer: \`200 OK\`
Line 9: \`Disallow: /*/drafts\`
Line 3: \`Disallow: /*/drafts\`
Page: \`${origin()}/${project}/drafts\``);

    // A sign-in the reviewer is past: a request without cookies is redirected, which is a note
    await page.goto(`${origin()}/${project}/private`);
    ({ check } = await openCrawlers(page));
    await expect(check('crawl-status')).toHaveAttribute('data-uier-check-state', 'none');
    await expect(check('crawl-status')).toContainText('A request without cookies is redirected to another page. Sites under review are often protected on purpose.');
    await expect(check('crawl-status')).toContainText(`${origin()}/login`);
    await expect(check('crawl-served')).toContainText('Not compared: the request did not get this page.');
    await expect(check('crawl-x-robots-tag')).toHaveCount(0);

    // An error for a request without cookies (a single-page app's server): worth a look
    await page.goto(`${origin()}/${project}/missing`);
    ({ check } = await openCrawlers(page));
    await expect(check('crawl-status')).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(check('crawl-status')).toContainText('404');
    await expect(check('crawl-status')).toContainText('The server answers 404 Not Found to a request without cookies.');
    await expect(check('crawl-status').getByRole('button', { name: 'Comment' })).toBeVisible();
});

test('a site whose Content-Security-Policy blocks requests to its own origin gets one note', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(60_000);
    const requests = siteRequests(page);
    await memberReview(page, 'crawler-csp', 'csp');
    const { section, check } = await openCrawlers(page);
    await expect(section.locator('[data-uier-check]')).toHaveCount(1);
    await expect(check('crawl-blocked')).toHaveAttribute('data-uier-check-state', 'none');
    await expect(check('crawl-blocked')).toContainText('Not checked: the site\'s Content-Security-Policy blocks requests to its own origin.');
    // Nothing more is asked once the first request is blocked
    expect(requests.count('/robots.txt')).toBe(0);
    expect(requests.count('/llms.txt')).toBe(0);
});
