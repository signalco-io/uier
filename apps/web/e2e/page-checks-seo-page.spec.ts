import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { linkRequests, mostAtOnce } from './support/fixtures/seoPage';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished, toolbar } from './support/toolbar';

// More of the SEO panel's own Page, Links and Images checks (packages/toolbar/docs/page-checks-seo-page.md)
// on the reviewed site's `fixture-seo-page` origin (e2e/support/fixtures/seoPage.ts): the viewport,
// language and hreflang tags, generic link text, Check links (which requests nothing until pressed,
// and never a link that looks like an action) and the images' dimensions, size, loading and weight.

test.use({ actionTimeout: 15_000 });

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

const origin = () => site.origin('fixture-seo-page');

/** The next comment the toolbar posts, with its body */
function nextCreate(page: Page, project: string) {
    return page.waitForRequest((request: Request) => request.method() === 'POST' && new URL(request.url()).pathname === `/api/review/${project}/comments`);
}

/** A member reviews the fixture's page through the app's review link */
async function memberReview(page: Page, label: string, query: string) {
    await signIn(page, uniqueEmail(label));
    const project = await createProject(page, { urls: [origin()] });
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${origin()}/${project}/pricing?${query}`)}`);
    await expect(toolbar(page)).toBeVisible();
    return project;
}

async function openSeo(page: Page) {
    await toolbar(page).getByRole('button', { name: /^SEO/ }).click();
    const panel = page.getByRole('complementary', { name: 'SEO' });
    await expect(panel.getByRole('button', { name: 'Close SEO panel' })).toBeFocused();
    return { panel, check: (id: string) => panel.locator(`[data-uier-check="${id}"]`), links: panel.locator('[data-uier-link-check]') };
}

const issue = (check: Locator, label: string) => check.getByRole('listitem').filter({ hasText: label });

test('the SEO panel checks the viewport, language, hreflang, generic link text and images, and requests links only on Check links', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(90_000);
    const project = await memberReview(page, 'seo-page', 'hreflang=bad');
    // The hero image is the largest content once loaded, before the first press ends the measurement
    await expect.poll(() => page.locator('#hero').evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    const { panel, check, links } = await openSeo(page);

    // Page: the viewport and language pass; the hreflang tags' problems, each naming its tags
    await expect(check('viewport')).toHaveAttribute('data-uier-check-state', 'pass');
    await expect(check('viewport')).toContainText('width=device-width');
    await expect(check('lang')).toHaveAttribute('data-uier-check-state', 'pass');
    const hreflang = check('hreflang');
    await expect(hreflang).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(hreflang).toContainText('4 problems with the hreflang tags.');
    await expect(hreflang).toContainText('en_us, de, fr');
    await expect(hreflang.getByRole('listitem')).toHaveText([
        /Not a language code: "en_US"\./, /Not a full address: "\/de\/plans"\./, /More than one tag for "fr"\./, /None points to this page\./
    ]);

    // Links: generic text, with what they share said once; a link with a label of its own is left out
    const generic = check('link-generic');
    await expect(generic).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(generic).toContainText('2 links say nothing out of context.');
    await expect(generic.getByRole('listitem')).toHaveCount(2);
    await expect(issue(generic, 'a#read-more')).toContainText('Its text is only "Read more".');
    await expect(issue(generic, 'a#click-here')).toContainText('Its text is only "click here".');

    // Images: no dimensions (an aspect-ratio counts), oversized, lazy where the visitor looks first, heavy
    await expect(check('image-dimensions')).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(check('image-dimensions').getByRole('listitem')).toHaveText([/img#no-size/]);
    await expect(check('image-dimensions')).toContainText('It can shift the page while it loads.');
    await expect(check('image-size')).toContainText('1 image is over twice the size it is shown at. 2400 × 1600 shown at 300 × 200.');
    await expect(check('image-size').getByRole('listitem')).toHaveText([/img#oversized/]);
    await expect(check('image-loading')).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(check('image-loading')).toContainText('The page\'s largest content. It delays what the visitor sees first.');
    await expect(check('image-loading').getByRole('listitem')).toHaveText([/img#hero/]);
    await expect(check('image-offscreen')).toHaveAttribute('data-uier-check-state', 'none');
    await expect(check('image-offscreen').getByRole('listitem')).toHaveText([/img#heavy/]);
    await expect(check('image-weight')).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(check('image-weight')).toContainText(/1 image file is over 500 KB\. 7\d\d KB\./);
    await expect(check('image-weight').getByRole('listitem')).toHaveText([/img#heavy/]);
    // The summary counts them with the panel's own checks
    await expect(panel.locator('[data-uier-summary="warn"] [data-uier-summary-count]')).toHaveText(String(await panel.locator('[data-uier-check-state="warn"]').count()));

    // Nothing is requested until Check links is pressed
    await expect(links.getByRole('status')).toHaveText('Requests the links to this site\'s pages to find the ones that answer with an error.');
    expect(linkRequests(project)).toEqual([]);
    await links.getByRole('button', { name: 'Check links' }).click();
    await expect(links.getByRole('status')).toHaveText('Checked 6 of 6.');
    await expect(links.getByRole('button', { name: 'Check links again' })).toBeFocused();
    const status = check('link-status');
    await expect(status).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(status).toContainText('Checked 6 addresses on this site');
    await expect(status).toContainText('2 links answer with an error.');
    await expect(issue(status, 'a#missing-link')).toContainText('Answers 404.');
    await expect(issue(status, 'a#broken-link')).toContainText('Answers 500.');
    await expect(status.getByRole('listitem')).toHaveCount(2);
    await expect(check('link-access')).toHaveAttribute('data-uier-check-state', 'none');
    await expect(check('link-access')).toContainText('1 link may need another sign-in. Answers 403.');
    await expect(check('link-access').getByRole('listitem')).toHaveText([/a#private-link/]);
    await expect(check('link-redirect')).toContainText('1 link redirects to another address.');
    await expect(check('link-redirect').getByRole('listitem')).toHaveText([/a#moved-link/]);
    await expect(check('link-skipped')).toContainText('1 link to other sites, 2 links that look like actions or downloads, 1 link that is not a web address.');

    // Each address once (three links share /ok), HEAD first and GET when HEAD is refused or answers with
    // an error; never /logout or the download, never another site
    const base = `/seo-page/${project}`;
    const requested = linkRequests(project);
    expect([...requested].sort()).toEqual([
        `GET ${base}/broken`, `GET ${base}/head-refused`, `GET ${base}/missing`, `HEAD ${base}/broken`, `HEAD ${base}/head-refused`,
        `HEAD ${base}/missing`, `HEAD ${base}/moved`, `HEAD ${base}/ok`, `HEAD ${base}/private`
    ]);
    expect(requested.indexOf(`HEAD ${base}/head-refused`)).toBeLessThan(requested.indexOf(`GET ${base}/head-refused`));

    // A link that answers 404 is a comment on that link, with its text and address
    const created = nextCreate(page, project);
    await issue(status, 'a#missing-link').getByRole('button', { name: 'Comment' }).click();
    const body = (await created).postDataJSON();
    expect(body.text).toBe(`SEO: This link answers 404 (Not found) when requested from this browser.\nLink text: \`Old plans\`\nAddress: \`${base}/missing\``);
    expect(body.check).toEqual({ type: 'seo', id: 'link-status' });
    expect(body.position.selector).toContain('missing-link');
    await expect(issue(status, 'a#missing-link')).toContainText(/Comment posted as #1/);

    await animationsFinished(panel);
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });

    // Check again drops what Check links found, and requests nothing on its own
    const sent = linkRequests(project).length;
    await panel.getByRole('button', { name: 'Check again' }).click();
    await expect(check('link-status')).toHaveCount(0);
    await expect(links.getByRole('button', { name: 'Check links' })).toBeVisible();
    await expect(check('image-size')).toBeVisible();
    expect(linkRequests(project)).toHaveLength(sent);
});

test('Check links requests at most 100 addresses, a few at a time, and Stop keeps what it found', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(90_000);
    const project = await memberReview(page, 'seo-page-links', 'many-links');
    const { check, links } = await openSeo(page);

    await links.getByRole('button', { name: 'Check links' }).click();
    await expect(links.getByRole('status')).toHaveText(/^Checked [1-9]\d? of 100$/);
    await links.getByRole('button', { name: 'Stop' }).click();
    await expect(links.getByRole('status')).toHaveText(/^Stopped after \d+ of 100\.$/);
    await expect(links.getByRole('button', { name: 'Check links again' })).toBeFocused();
    const stoppedAt = Number(/after (\d+)/.exec(await links.getByRole('status').textContent() ?? '')?.[1]);
    expect(stoppedAt).toBeLessThan(100);
    await expect(check('link-status')).toContainText(`Stopped after ${stoppedAt} of 100`);
    await expect(check('link-status')).toContainText('None of these answered with an error.');
    // The requests on their way when it stopped are cancelled, and no more are sent
    const sent = linkRequests(project).length;
    expect(sent).toBeLessThanOrEqual(stoppedAt + 4);
    await page.waitForTimeout(500);
    expect(linkRequests(project)).toHaveLength(sent);

    // To the end: the first 100 of the 120 addresses, four at a time at most
    await links.getByRole('button', { name: 'Check links again' }).click();
    await expect(links.getByRole('status')).toHaveText('Checked 100 of 100.', { timeout: 30_000 });
    await expect(check('link-status')).toHaveAttribute('data-uier-check-state', 'pass');
    await expect(check('link-status')).toContainText('Checked the first 100 of 120 addresses on this site');
    await expect(check('link-status')).toContainText('Every address answered without an error.');
    expect(linkRequests(project).filter(line => /\/item-(?:10[1-9]|11\d|120)$/.test(line))).toEqual([]);
    expect(mostAtOnce(project)).toBeGreaterThan(1);
    expect(mostAtOnce(project)).toBeLessThanOrEqual(4);
});

test('a page without a viewport or language, a page in German, valid and canonical hreflang sets, and a CSP that blocks Check links', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(90_000);
    await signIn(page, uniqueEmail('seo-page-variants'));
    const project = await createProject(page, { urls: [origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    await page.context().clearCookies();
    const open = async (query: string) => {
        await page.goto(`${origin()}/${project}/pricing?review=true&${query}`);
        return openSeo(page);
    };

    // No viewport meta tag: a warning; no lang: a note; the English phrases still apply to a page of unknown language
    let { check } = await open('bare');
    await expect(check('viewport')).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(check('viewport')).toContainText('No viewport meta tag. Phones show the page zoomed out.');
    await expect(check('lang')).toHaveAttribute('data-uier-check-state', 'none');
    await expect(check('lang')).toContainText('No lang attribute on html.');
    await expect(check('link-generic')).toContainText('1 link says nothing out of context. Its text is only "Read more".');
    await expect(check('hreflang')).toHaveCount(0);

    // A page in German: the English phrases are not checked
    ({ check } = await open('lang=de'));
    await expect(check('lang')).toHaveAttribute('data-uier-check-state', 'pass');
    await expect(check('link-generic')).toHaveAttribute('data-uier-check-state', 'none');
    await expect(check('link-generic')).toContainText('Not checked: the phrases checked are English, and the page is in de.');

    // A valid set with this page among them, then one that leaves out the canonical address
    ({ check } = await open('hreflang=good'));
    await expect(check('hreflang')).toHaveAttribute('data-uier-check-state', 'pass');
    await expect(check('hreflang')).toContainText('3 hreflang tags, valid and absolute, with this page among them.');
    await expect(check('hreflang')).toContainText('en, de, x-default');
    ({ check } = await open('hreflang=canonical'));
    await expect(check('hreflang')).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(check('hreflang')).toContainText(`None points to the canonical address, ${origin()}/plans.`);

    // The site's CSP does not allow requests to its own origin: one note, nothing requested
    let links: Locator;
    ({ check, links } = await open('blocked-links'));
    await links.getByRole('button', { name: 'Check links' }).click();
    await expect(links.getByRole('status')).toHaveText('Not checked.');
    await expect(check('link-status')).toHaveAttribute('data-uier-check-state', 'none');
    await expect(check('link-status')).toContainText('Not checked: the site\'s Content-Security-Policy does not allow requests to its own addresses (connect-src).');
    await expect(check('link-status').getByRole('listitem')).toHaveCount(0);
    await expect(check('link-skipped')).toHaveCount(0);
    expect(linkRequests(project)).toEqual([]);
});
