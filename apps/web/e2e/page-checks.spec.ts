import { expect, test, type Page, type Request } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { auditAssetPath, auditRuns, observeAuditRuns } from './support/auditRuns';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished, chooseInboxPages, commentBubble, inboxPages, openThread, setThreadStatus, toolbar } from './support/toolbar';
import { verifiedReviewHeaders } from './support/reviewVerification';

// The toolbar's Accessibility and SEO panels (packages/toolbar/docs/page-checks.md) on a project's
// site on another origin, with the install guide's Content-Security-Policy: both check the page in the
// background once the toolbar loaded, and axe-core loads as its own integrity-checked asset.

test.use({ actionTimeout: 15_000 });

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

const auditPath = auditAssetPath;

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

test('the Accessibility panel audits the page in the background without the toolbar, marks its button, highlights an element and posts its issue', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout; the phone test is below');
    test.setTimeout(90_000);
    const audit = await auditPath();
    const auditRequests: string[] = [];
    page.on('request', request => { if (new URL(request.url()).pathname === audit) auditRequests.push(request.url()); });
    const project = await memberReview(page, 'a11y-panel');

    // Checked in the background once the page loaded: the buttons say what was found, with a dot
    const button = toolbar(page).getByRole('button', { name: /^Accessibility/ });
    await expect(button).toHaveAccessibleName(/^Accessibility, \d+ issues? found$/, { timeout: 20_000 });
    await expect(button.locator('[data-uier-attention="accessibility"]')).toBeVisible();
    const seoButton = toolbar(page).getByRole('button', { name: /^SEO/ });
    await expect(seoButton).toHaveAccessibleName(/^SEO, \d+ to look at$/);
    await expect(seoButton.locator('[data-uier-attention="seo"]')).toBeVisible();
    expect(auditRequests).toHaveLength(1);

    // The panel opens with the report, without checking again
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const panel = page.getByRole('complementary', { name: 'Accessibility' });
    await expect(panel.getByRole('button', { name: 'Close Accessibility panel' })).toBeFocused();
    await expect(panel.getByRole('status')).toHaveText(/^\d+ issues? found\.$/);
    expect(auditRequests).toHaveLength(1);

    // By impact, with the rule, its help link and the element; the toolbar itself is left out
    const imageRule = panel.locator('[data-uier-rule="image-alt"]');
    await expect(imageRule.getByRole('heading', { name: 'Images must have alternative text' })).toBeVisible();
    await expect(imageRule.getByRole('link', { name: /How to fix/ })).toHaveAttribute('href', /^https:\/\/dequeuniversity\.com\/rules\/axe\/[\d.]+\/image-alt$/);
    await expect(imageRule).toContainText('img#plan-chart');
    await expect(panel.locator('[data-uier-impact="critical"]').locator('[data-uier-rule="image-alt"]')).toHaveCount(1);
    await expect(panel.locator('[data-uier-rule="link-name"]')).toContainText('a#empty-link');
    await expect(panel).not.toContainText('uier-toolbar');
    // The summary first, a tile for each impact with its elements' count
    const elementCount = (impact: string) => panel.locator(`[data-uier-impact="${impact}"] [data-uier-rule] li`).count();
    await expect(panel.locator('[data-uier-summary="critical"]')).toContainText('Critical');
    await expect(panel.locator('[data-uier-summary="critical"] dd')).toHaveText(String(await elementCount('critical')));
    await expect(panel.locator('[data-uier-summary="serious"] dd')).toHaveText(String(await elementCount('serious')));
    // A line every element of a rule shares is said once, under its title, not on the element
    await expect(imageRule).toContainText('Element does not have an alt attribute');
    // The rule's row names the success criterion it tests
    await expect(imageRule).toContainText('WCAG 1.1.1 (A)');
    await expect(imageRule.getByRole('listitem').filter({ hasText: 'img#plan-chart' })).not.toContainText('alt attribute');

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
    // The comment says what was found on the element, the standard and the rule; the request names the check
    expect(body.text).toMatch(/^Accessibility \(critical\): Images must have alternative text\.\nElement: `#plan-chart`\nFix any of the following:\n- Element does not have an alt attribute\n(?:- .+\n)*\nWCAG 1\.1\.1 \(A\)\. Rule image-alt: https:\/\/dequeuniversity\.com\/rules\/axe\/[\d.]+\/image-alt$/);
    expect(body.text.length).toBeLessThanOrEqual(1000);
    expect(body.check).toEqual({ type: 'accessibility', id: 'image-alt' });
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
    const button = toolbar(page).getByRole('button', { name: /^SEO/ });
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
    await expect(check('levels')).toContainText('An h3 after an h1, skipping a level.');
    // The outline is folded until asked for
    await expect(panel.getByRole('list', { name: 'Headings outline' })).toBeHidden();
    await panel.locator('summary', { hasText: 'Outline' }).click();
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
    // The summary first: what is worth a look and what passed
    await expect(panel.locator('[data-uier-summary="warn"]')).toContainText('To look at');
    await expect(panel.locator('[data-uier-summary="warn"] dd')).toHaveText(String(await panel.locator('[data-uier-check-state="warn"]').count()));
    await expect(panel.locator('[data-uier-summary="pass"] dd')).toHaveText(String(await panel.locator('[data-uier-check-state="pass"]').count()));

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
    expect(body.check).toEqual({ type: 'seo', id: 'description' });
    expect(body.screenshot).toMatch(/^data:image\//);
    await expect(check('description')).toContainText(/Bug report sent as #1/);
    await expect(panel.getByRole('textbox', { name: 'Your name' })).toBeHidden();

    // An element's issue is pinned to it; with the keyboard the focus stays on the action, now Show
    created = nextCreate(page, project);
    await check('levels').getByRole('button', { name: 'Comment' }).focus();
    await page.keyboard.press('Enter');
    body = (await created).postDataJSON();
    // What was found is in the comment, as code
    expect(body.text).toBe('SEO: This h3 comes after an h1, skipping a level.\nHeading: `Plans in detail`');
    expect(body.check).toEqual({ type: 'seo', id: 'levels' });
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

    // Links that look broken for the same reason say it once, in the check's reason, above their rows
    await page.evaluate(() => {
        document.getElementById('missing-anchor')?.setAttribute('href', 'javascript:void(0)');
    });
    await panel.getByRole('button', { name: 'Check again' }).click();
    await expect(check('link-address')).toContainText('2 links look broken. It runs a script instead of opening a page.');
    await expect(check('link-address').getByRole('listitem')).toHaveCount(2);
    await expect(check('link-address').getByRole('listitem').filter({ hasText: 'It runs a script' })).toHaveCount(0);
});

test('a finding that is already reported stays marked after a reload, until its thread is done', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(60_000);
    const project = await memberReview(page, 'reported-findings');
    const button = toolbar(page).getByRole('button', { name: /^SEO/ });
    await button.click();
    const panel = page.getByRole('complementary', { name: 'SEO' });
    const check = (id: string) => panel.locator(`[data-uier-check="${id}"]`);

    // An element's issue and one about the page, each posted with its check
    let created = nextCreate(page, project);
    await check('description').getByRole('button', { name: 'Comment' }).click();
    expect((await created).postDataJSON().check).toEqual({ type: 'seo', id: 'description' });
    await expect(check('description')).toContainText(/Bug report sent as #1/);
    created = nextCreate(page, project);
    await check('levels').getByRole('button', { name: 'Comment' }).click();
    await created;
    await expect(check('levels')).toContainText(/Comment posted as #2/);

    // After a reload the panel knows them from the page's threads: no second comment for the same finding
    await page.reload();
    await expect(check('levels')).toContainText('Reported as #2');
    await expect(check('levels').getByRole('button', { name: 'Comment' })).toHaveCount(0);
    await expect(check('description')).toContainText('Reported as #1');
    await expect(check('description').getByRole('button', { name: 'Comment' })).toHaveCount(0);
    // A finding nobody reported still offers its comment
    await expect(check('canonical').getByRole('button', { name: 'Comment' })).toBeVisible();
    await expect(check('link-text').getByRole('button', { name: 'Comment' })).toBeVisible();
    await animationsFinished(panel);
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });

    // Show opens the thread that reported it
    await check('levels').getByRole('button', { name: 'Show' }).click();
    await expect(panel).toBeHidden();
    const thread = openThread(page);
    await expect(thread).toContainText('This h3 comes after an h1');

    // Once the thread is done, the finding (still on the page) can be reported again
    await setThreadStatus(page, thread, 'Done');
    await page.keyboard.press('Escape');
    await button.click();
    await expect(check('levels').getByRole('button', { name: 'Comment' })).toBeVisible();
    await expect(check('levels')).not.toContainText('Reported');
    await expect(check('description')).toContainText('Reported as #1');
});

test('an open panel stays open on the next page and shows that page', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(60_000);
    await signIn(page, uniqueEmail('panel-navigation'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    await page.context().clearCookies();
    await page.goto(`${site.origin()}/${project}/pricing?review=true&page-checks`);
    await toolbar(page).getByRole('button', { name: /^SEO/ }).click();
    const panel = page.getByRole('complementary', { name: 'SEO' });
    // Folded, but in the panel: its text says which page was checked
    const outline = panel.locator('ol[aria-label="Headings outline"]');
    await expect(outline).toContainText('Pricing for pricing');

    // A client-side navigation that renders the new page after the address changes: checked once it settled
    await page.getByRole('heading', { level: 1 }).click();
    await page.evaluate(() => {
        history.pushState({}, '', `${location.pathname}/annual${location.search}`);
        window.setTimeout(() => { document.querySelector('h1')!.textContent = 'Annual plans'; }, 100);
    });
    await expect(outline).toContainText('Annual plans');
    await expect(outline).not.toContainText('Pricing for');
    // It stayed: the focus is where it was
    await expect(panel.getByRole('button', { name: 'Close SEO panel' })).not.toBeFocused();

    // A full page load from the site (a link, here) opens it again for the new page, and so does a reload
    await page.evaluate(url => location.assign(url), `${site.origin()}/${project}/features?page-checks`);
    await expect(outline).toContainText('Pricing for features');
    await page.reload();
    await expect(outline).toContainText('Pricing for features');

    // The inbox too, and a closed panel stays closed
    await toolbar(page).getByRole('button', { name: 'Inbox', exact: true }).click();
    const inbox = page.getByRole('complementary', { name: 'Comments' });
    await expect(inbox).toBeVisible();
    await expect(panel).toBeHidden();
    await page.evaluate(() => history.pushState({}, '', `${location.pathname}/team${location.search}`));
    await expect(inbox).toBeVisible();
    await inbox.getByRole('button', { name: 'Close sidebar' }).click();
    await expect(inbox).toBeHidden();
    await page.reload();
    await expect(toolbar(page)).toBeVisible();
    await expect(inbox).toBeHidden();
    await expect(panel).toBeHidden();

    // A page opened anew (not from the site) starts without a panel
    await toolbar(page).getByRole('button', { name: /^SEO/ }).click();
    await expect(panel).toBeVisible();
    await page.goto(`${site.origin()}/${project}/pricing?page-checks`);
    await expect(toolbar(page)).toBeVisible();
    await expect(panel).toBeHidden();
});

test('a panel that stays open shows the page it reached, never the previous one, and not in a window opened from it', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(90_000);
    await signIn(page, uniqueEmail('panel-next-page'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const posted = await request.post(`/api/review/${project}/comments`, { headers, data: {
        path: `/${project}/features`, position: { type: 'page' }, kind: 'feedback', text: 'Features need a comparison table', authorName: 'Reviewer'
    } });
    expect(posted.status()).toBe(201);
    await page.context().clearCookies();
    // axe-core loads slowly: the audit started on this page still runs after the next one rendered
    const audit = await auditPath();
    await page.route(`**${audit}`, async route => {
        await new Promise(resolve => setTimeout(resolve, 2_000));
        await route.continue();
    });
    await page.goto(`${site.origin()}/${project}/pricing?review=true&page-checks`);
    await toolbar(page).getByRole('button', { name: /^Accessibility/ }).click();
    const accessibility = page.getByRole('complementary', { name: 'Accessibility' });
    await expect(accessibility.getByRole('status')).toHaveText('Checking this page...');
    await page.evaluate(() => history.pushState({}, '', `${location.pathname.replace(/\/pricing$/, '/team')}${location.search}`));
    await expect(accessibility.getByRole('status')).toHaveText(/^\d+ issues? found\.$/, { timeout: 20_000 });
    await expect(accessibility).not.toContainText('These results are for');

    // A window opened from the site copies its session storage and has its referrer, but starts without a panel
    const [opened] = await Promise.all([
        page.context().waitForEvent('page'),
        page.evaluate(url => { window.open(url); }, `${site.origin()}/${project}/features?review=true&page-checks`)
    ]);
    await expect(toolbar(opened)).toBeVisible();
    await expect(opened.getByRole('complementary', { name: 'Accessibility' })).toBeHidden();
    await expect(opened.getByRole('complementary', { name: 'Comments' })).toBeHidden();
    await opened.close();
    await expect(accessibility).toBeVisible();

    // The inbox showing another page lists its comments once that page is this one
    await toolbar(page).getByRole('button', { name: /^Inbox/ }).click();
    const inbox = page.getByRole('complementary', { name: 'Comments' });
    await chooseInboxPages(page, new RegExp(`^/${project}/features`));
    await expect(inbox).toContainText('Features need a comparison table');
    await page.evaluate(() => history.pushState({}, '', `${location.pathname.replace(/\/team$/, '/features')}${location.search}`));
    await expect(inbox).toContainText('Features need a comparison table');
    await expect(inboxPages(page)).toHaveAccessibleName(/This page$/);
});

test('a background audit nobody needs any more stops: collapsed while it loads or between its steps, and after Exit review', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(90_000);
    await signIn(page, uniqueEmail('audit-cancel'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    await page.context().clearCookies();
    await observeAuditRuns(page);
    // axe-core loads slowly: the background audit waits for it
    const audit = await auditPath();
    await page.route(`**${audit}`, async route => {
        await new Promise(resolve => setTimeout(resolve, 2_000));
        await route.continue();
    });
    const isAudit = (request: Request) => new URL(request.url()).pathname === audit;
    const pill = toolbar(page);
    const collapse = () => pill.getByRole('button', { name: 'Collapse toolbar' }).click();
    const expand = () => page.getByRole('button', { name: /^Expand toolbar/ }).click();
    const runCount = async () => (await auditRuns(page)).length;

    // Collapsed while axe-core loads: it never runs
    let requested = page.waitForRequest(isAudit);
    await page.goto(`${site.origin()}/${project}/pricing?review=true&page-checks&sections=250`);
    await requested;
    await collapse();
    await page.waitForResponse(response => isAudit(response.request()));
    await page.waitForTimeout(1_000);
    expect(await runCount()).toBe(0);

    // Collapsed between its steps (on a slower CPU, so it is still running): the step that runs ends, no other starts
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    try {
        await expand();
        await expect.poll(runCount, { intervals: [50] }).toBeGreaterThan(0);
        await collapse();
        await page.waitForTimeout(500);
        const stopped = await runCount();
        await page.waitForTimeout(1_500);
        expect(await runCount()).toBe(stopped);
    } finally {
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
    // Expanded again, the page is checked from the start, to the end
    await expand();
    await expect(pill.getByRole('button', { name: /^Accessibility/ })).toHaveAccessibleName(/^Accessibility, \d+ issues? found$/, { timeout: 30_000 });

    // Exit review while axe-core loads: it never runs on the page left without the toolbar
    requested = page.waitForRequest(isAudit);
    await page.reload();
    await requested;
    await pill.getByRole('button', { name: 'Options', exact: true }).click();
    await page.getByRole('button', { name: 'Exit review', exact: true }).click();
    await expect(toolbar(page)).toHaveCount(0);
    await page.waitForResponse(response => isAudit(response.request()));
    await page.waitForTimeout(1_000);
    expect(await runCount()).toBe(0);
});

test('on a phone the panels open from Options, keep the pill as wide as before, fit the screen and post with a tap', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.use.isMobile, 'Phone layout');
    test.setTimeout(90_000);
    const project = await memberReview(page, 'checks-mobile');
    const pill = toolbar(page);
    // The pill keeps its buttons in view: the panels are in Options here
    await expect(pill.getByRole('button', { name: /^SEO/ })).toHaveCount(0);
    const collapse = (await pill.getByRole('button', { name: 'Collapse toolbar' }).boundingBox())!;
    expect(collapse.x + collapse.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    const openFromOptions = async (name: string) => {
        await pill.getByRole('button', { name: 'Options', exact: true }).tap();
        await page.getByRole('dialog', { name: 'Options' }).getByRole('button', { name: new RegExp(`^${name}`) }).tap();
    };
    // The background checks mark their Options rows; the dot is beside the row's name
    await pill.getByRole('button', { name: 'Options', exact: true }).tap();
    const options = page.getByRole('dialog', { name: 'Options' });
    await expect(options.getByRole('button', { name: /^Accessibility, \d+ issues? found$/ })).toBeVisible({ timeout: 20_000 });
    await expect(options.locator('[data-uier-attention="accessibility"]')).toBeVisible();
    await expect(options.getByRole('button', { name: /^SEO, \d+ to look at$/ })).toBeVisible();
    await options.getByRole('button', { name: /^SEO/ }).tap();
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
