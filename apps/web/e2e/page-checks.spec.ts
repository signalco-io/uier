import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expect, test, type Page, type Request } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished, commentBubble, openThread, toolbar } from './support/toolbar';

// The toolbar's Accessibility and SEO panels (packages/toolbar/docs/page-checks.md) on a project's
// site on another origin, with the install guide's Content-Security-Policy: axe-core loads as its
// own integrity-checked asset only when the Accessibility panel opens.

test.use({ actionTimeout: 15_000 });

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

const auditPath = async () => `/toolbar/${createHash('sha256')
    .update(await readFile(new URL('../../../packages/toolbar/dist/audit.js', import.meta.url))).digest('hex')}.js`;

/** The next comment the toolbar posts, with its body */
function nextCreate(page: Page, project: string) {
    return page.waitForRequest((request: Request) => request.method() === 'POST' && new URL(request.url()).pathname === `/api/review/${project}/comments`);
}

/** A member reviews the site through the app's review link */
async function memberReview(page: Page, label: string) {
    await signIn(page, uniqueEmail(label));
    const project = await createProject(page, { urls: [site.origin()] });
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${site.origin()}/${project}/pricing?page-checks`)}`);
    await expect(toolbar(page)).toBeVisible();
    return project;
}

test('the Accessibility panel loads axe-core only when opened, audits the page without the toolbar, highlights an element and posts its issue', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout; the phone test is below');
    test.setTimeout(90_000);
    const audit = await auditPath();
    const auditRequests: string[] = [];
    page.on('request', request => { if (new URL(request.url()).pathname === audit) auditRequests.push(request.url()); });
    const project = await memberReview(page, 'a11y-panel');
    await page.waitForLoadState('networkidle');
    expect(auditRequests).toEqual([]);

    const button = toolbar(page).getByRole('button', { name: 'Accessibility', exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const panel = page.getByRole('complementary', { name: 'Accessibility' });
    await expect(panel.getByRole('button', { name: 'Close Accessibility panel' })).toBeFocused();
    await expect(panel.getByRole('status')).toHaveText(/^\d+ issues? found\.$/, { timeout: 20_000 });
    expect(auditRequests).toHaveLength(1);

    // By impact, with the rule, its help link and the element; the toolbar itself is left out
    const imageRule = panel.locator('[data-uier-rule="image-alt"]');
    await expect(imageRule.getByRole('heading', { name: 'Images must have alternative text' })).toBeVisible();
    await expect(imageRule.getByRole('link', { name: /How to fix/ })).toHaveAttribute('href', /^https:\/\/dequeuniversity\.com\/rules\/axe\/[\d.]+\/image-alt$/);
    await expect(imageRule).toContainText('img#plan-chart');
    await expect(panel.locator('[data-uier-impact="critical"]').locator('[data-uier-rule="image-alt"]')).toHaveCount(1);
    await expect(panel.locator('[data-uier-rule="link-name"]')).toContainText('a#empty-link');
    await expect(panel).not.toContainText('uier-toolbar');

    // Highlight outlines the element on the page
    const item = imageRule.getByRole('listitem').filter({ hasText: 'img#plan-chart' });
    await item.getByRole('button', { name: 'Highlight' }).click();
    await expect(item.getByRole('button', { name: 'Highlight' })).toHaveAttribute('aria-pressed', 'true');
    const outline = page.locator('[data-uier-check-highlight]');
    await expect(outline).toBeVisible();
    const [outlineBox, imageBox] = [await outline.boundingBox(), await page.locator('#plan-chart').boundingBox()];
    expect(Math.abs(outlineBox!.x - imageBox!.x) + Math.abs(outlineBox!.y - imageBox!.y)).toBeLessThan(2);

    // One click posts the comment on the element, with a screenshot and the browser's details
    const created = nextCreate(page, project);
    await item.getByRole('button', { name: 'Comment' }).click();
    const body = (await created).postDataJSON();
    expect(body.text).toMatch(/^Accessibility \(critical\): Images must have alternative text\.\nRule image-alt: https:\/\/dequeuniversity\.com\/rules\/axe\/[\d.]+\/image-alt$/);
    expect(body.position).toMatchObject({ type: 'point', xNormal: 0.5, yNormal: 0.5 });
    expect(body.position.selector).toContain('plan-chart');
    expect(body.kind).toBeUndefined();
    expect(body.screenshot).toMatch(/^data:image\//);
    expect(body.device).toMatchObject({ windowSize: expect.any(Object) });
    await expect(item).toContainText(/Comment posted as #1/);
    await expect(commentBubble(page, 1, 1)).toBeVisible();

    await animationsFinished(panel);
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });

    // Show opens its thread; the report and the posted comment are kept for the next opening
    await item.getByRole('button', { name: 'Show' }).click();
    await expect(panel).toBeHidden();
    await expect(openThread(page)).toContainText('Images must have alternative text');
    await page.keyboard.press('Escape');
    await button.click();
    await expect(panel.locator('[data-uier-rule="image-alt"]').getByRole('listitem').filter({ hasText: 'img#plan-chart' })).toContainText(/Comment posted as #1/);
    expect(auditRequests).toHaveLength(1);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(button).toBeFocused();
});

test('the SEO panel reports the head, headings, links, images and Core Web Vitals, and posts page and element issues', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout; the phone test is below');
    test.setTimeout(90_000);
    await signIn(page, uniqueEmail('seo-panel'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    // A guest: the panel asks for the name comments are posted with
    await page.context().clearCookies();
    await page.goto(`${site.origin()}/${project}/pricing?review=true&page-checks`);
    const button = toolbar(page).getByRole('button', { name: 'SEO', exact: true });
    await button.click();
    const panel = page.getByRole('complementary', { name: 'SEO' });
    await expect(panel.getByRole('button', { name: 'Close SEO panel' })).toBeFocused();

    const check = (id: string) => panel.locator(`[data-uier-check="${id}"]`);
    await expect(check('title')).toHaveAttribute('data-uier-check-state', 'pass');
    await expect(check('title')).toContainText('Reviewed site');
    await expect(check('description')).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(check('description')).toContainText('No meta description.');
    await expect(check('canonical')).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(check('h1')).toHaveAttribute('data-uier-check-state', 'pass');
    await expect(check('levels')).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(check('levels')).toContainText('An h3 after an h1.');
    await expect(panel.getByRole('list', { name: 'Headings outline' })).toContainText('Plans in detail');
    await expect(check('link-text')).toContainText('a#empty-link');
    await expect(check('link-address')).toContainText('It runs a script instead of opening a page.');
    await expect(check('link-address')).toContainText('It points to #faq, which is not on this page.');
    await expect(check('alt')).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(check('alt')).toContainText('img#plan-chart');
    // Measured in this browser (Chromium reports all three)
    await expect(check('vital-LCP')).not.toHaveAttribute('data-uier-check-state', 'none');
    await expect(check('vital-LCP')).toContainText(/\d\.\d s/);
    await expect(check('vital-CLS')).toHaveAttribute('data-uier-check-state', 'pass');
    // The toolbar's own presses are not the page's interactions
    await expect(check('vital-INP')).toHaveAttribute('data-uier-check-state', 'none');
    await expect(check('vital-INP')).toContainText('No interactions yet.');

    // A page issue needs the guest's name first, then is page feedback (a bug report)
    await check('description').getByRole('button', { name: 'Comment' }).click();
    await expect(panel.getByRole('alert')).toHaveText('Enter your name to comment.');
    await expect(panel.getByRole('textbox', { name: 'Your name' })).toBeFocused();
    await page.keyboard.type('Search reviewer');
    let created = nextCreate(page, project);
    await check('description').getByRole('button', { name: 'Comment' }).click();
    let body = (await created).postDataJSON();
    expect(body).toMatchObject({ kind: 'bug', position: { type: 'page' }, authorName: 'Search reviewer' });
    expect(body.text).toBe('SEO: The page has no meta description. Search results may show any text from the page.');
    expect(body.screenshot).toMatch(/^data:image\//);
    await expect(check('description')).toContainText(/Bug report sent as #1/);
    await expect(panel.getByRole('textbox', { name: 'Your name' })).toBeHidden();

    // An element's issue is pinned to it; with the keyboard the focus stays on the action, now Show
    created = nextCreate(page, project);
    await check('levels').getByRole('button', { name: 'Comment' }).focus();
    await page.keyboard.press('Enter');
    body = (await created).postDataJSON();
    expect(body.text).toBe('SEO: This h3 comes after an h1, skipping a level.');
    expect(body.position.selector).toContain('h3');
    await expect(check('levels')).toContainText(/Comment posted as #2/);
    await expect(check('levels').getByRole('button', { name: 'Show' })).toBeFocused();
    await expect(commentBubble(page, 1, 2)).toBeVisible();

    // Posting removed the pressed buttons: still none of the page's own
    await expect(check('vital-INP')).toHaveAttribute('data-uier-check-state', 'none');
    await page.getByRole('heading', { level: 1 }).click();
    await expect(check('vital-INP')).toHaveAttribute('data-uier-check-state', 'pass');

    await animationsFinished(panel);
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });

    // Show for page feedback opens the inbox on it
    await check('description').getByRole('button', { name: 'Show' }).click();
    const inbox = page.getByRole('complementary', { name: 'Comments' });
    await expect(inbox).toBeVisible();
    await expect(inbox.getByRole('article')).toContainText('The page has no meta description.');
    await expect(panel).toBeHidden();

    // After a client-side navigation, the same finding on another page is not marked as posted
    await page.evaluate(() => history.pushState({}, '', `${location.pathname}/annual${location.search}`));
    await button.click();
    await expect(check('description')).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(check('description').getByRole('button', { name: 'Comment' })).toBeVisible();
    await expect(check('description')).not.toContainText(/sent as #1/);

    // A noindex page (like the uier app's) asks search engines not to index it: it needs no canonical link
    await expect(check('robots')).toHaveAttribute('data-uier-check-state', 'pass');
    await page.evaluate(() => document.head.insertAdjacentHTML('beforeend', '<meta name="robots" content="noindex, nofollow">'));
    await panel.getByRole('button', { name: 'Check again' }).click();
    await expect(check('robots')).toHaveAttribute('data-uier-check-state', 'none');
    await expect(check('robots')).toContainText('The page asks search engines not to index it.');
    await expect(check('robots')).toContainText('noindex, nofollow');
    await expect(check('canonical')).toHaveAttribute('data-uier-check-state', 'none');
    await expect(check('canonical')).toContainText('Not needed on a noindex page.');
    await expect(check('canonical').getByRole('button', { name: 'Comment' })).toHaveCount(0);
});

test('on a phone the panels open from Options, keep the pill as wide as before, fit the screen and post with a tap', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.use.isMobile, 'Phone layout');
    test.setTimeout(90_000);
    const project = await memberReview(page, 'checks-mobile');
    const pill = toolbar(page);
    // The pill keeps its buttons in view: the panels are in Options here
    await expect(pill.getByRole('button', { name: 'SEO', exact: true })).toHaveCount(0);
    const collapse = (await pill.getByRole('button', { name: 'Collapse toolbar' }).boundingBox())!;
    expect(collapse.x + collapse.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    const openFromOptions = async (name: string) => {
        await pill.getByRole('button', { name: 'Options', exact: true }).tap();
        await page.getByRole('dialog', { name: 'Options' }).getByRole('button', { name, exact: true }).tap();
    };
    await openFromOptions('SEO');
    const seo = page.getByRole('complementary', { name: 'SEO' });
    await expect(seo.locator('[data-uier-check="alt"]')).toContainText('img#plan-chart');
    const box = (await seo.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const created = nextCreate(page, project);
    await seo.locator('[data-uier-check="alt"]').getByRole('button', { name: 'Comment' }).tap();
    expect((await created).postDataJSON().position.selector).toContain('plan-chart');
    await expect(seo.locator('[data-uier-check="alt"]')).toContainText(/Comment posted as #1/);
    await seo.getByRole('button', { name: 'Close SEO panel' }).tap();
    await expect(seo).toBeHidden();
    await expect(pill.getByRole('button', { name: 'Options', exact: true })).toBeFocused();

    // The other panel takes the same place
    await openFromOptions('Accessibility');
    const accessibility = page.getByRole('complementary', { name: 'Accessibility' });
    await expect(accessibility.getByRole('button', { name: 'Close Accessibility panel' })).toBeFocused();
    await expect(accessibility.getByRole('status')).toHaveText(/^\d+ issues? found\.$/, { timeout: 20_000 });
    await expect(accessibility.locator('[data-uier-rule="image-alt"]')).toContainText('img#plan-chart');
    await animationsFinished(accessibility);
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });
});
