import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished, commentBubble, toolbar } from './support/toolbar';

// The panels' reporting core (packages/toolbar/docs/page-checks-report.md) on its own page of the
// reviewed site (`fixture-report`, e2e/support/fixtures/report.ts): WCAG 2.2 target size, what
// axe-core could not decide ("To review"), one comment for a rule's or a check's elements, and
// "Not an issue" kept in this browser.

test.use({ actionTimeout: 15_000 });

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

const origin = () => site.origin('fixture-report');

/** The next comment the toolbar posts */
function nextCreate(page: Page, project: string) {
    return page.waitForRequest((request: Request) => request.method() === 'POST' && new URL(request.url()).pathname === `/api/review/${project}/comments`);
}

/** A member reviews the fixture's page through the app's review link */
async function memberReview(page: Page, label: string, query = '') {
    await signIn(page, uniqueEmail(label));
    const project = await createProject(page, { urls: [origin()] });
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${origin()}/${project}/gallery${query}`)}`);
    await expect(toolbar(page)).toBeVisible();
    return project;
}

/** The background audit's report on the button: how many issues it found */
async function backgroundIssues(page: Page) {
    const button = toolbar(page).getByRole('button', { name: /^Accessibility/ });
    await expect(button).toHaveAccessibleName(/^Accessibility, \d+ issues? found$/, { timeout: 30_000 });
    return Number(/(\d+) issues?/.exec(await button.getAttribute('aria-label') ?? await button.innerText())?.[1]);
}

/** The short names of a list's elements, in order */
const labels = (list: Locator) => list.locator('li p.font-mono').allInnerTexts();

const accessibilityPanel = (page: Page) => page.getByRole('complementary', { name: 'Accessibility' });
const seoPanel = (page: Page) => page.getByRole('complementary', { name: 'SEO' });

test('target size is checked by the background audit as by Check again, and what axe-core could not decide is to review, not counted', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(90_000);
    const project = await memberReview(page, 'report-review');
    const button = toolbar(page).getByRole('button', { name: /^Accessibility/ });
    await expect(button).toHaveAccessibleName('Accessibility, 8 issues found', { timeout: 30_000 });
    await button.click();
    const panel = accessibilityPanel(page);
    await expect(panel.getByRole('status')).toHaveText('8 issues found.');

    // WCAG 2.5.8: the controls under 24 px close together, the select with its many options too
    const targetSize = panel.locator('[data-uier-impact="serious"] [data-uier-rule="target-size"]');
    await expect(targetSize).toContainText('WCAG 2.5.8 (AA)');
    await expect(targetSize).toContainText('Target has insufficient size');
    const background = await labels(targetSize.getByRole('list', { name: /^Elements:/ }));
    expect(background).toEqual(['button#tool-bold.report-tool', 'button#tool-italic.report-tool', 'button#tool-underline.report-tool', 'select#tool-size.report-size', 'button#tool-apply.report-tool']);

    // To review: after the impacts, the reason axe-core gave, not in the counts
    const review = panel.locator('[data-uier-review]');
    await expect(review.getByRole('heading', { name: /^To review/ })).toContainText('1');
    const contrast = review.locator('[data-uier-rule="color-contrast"]');
    await expect(contrast).toContainText('p#gradient-note.report-gradient');
    await expect(contrast).toContainText('Element\'s background color could not be determined due to a background gradient');
    const tiles = await Promise.all(['critical', 'serious', 'moderate', 'minor'].map(impact => panel.locator(`[data-uier-summary="${impact}"] [data-uier-summary-count]`).innerText()));
    expect(tiles.reduce((total, count) => total + Number(count), 0)).toBe(8);
    const backgroundReview = await labels(review);

    // Check again runs one audit of the whole page: the same report
    await panel.getByRole('button', { name: 'Check again' }).click();
    await expect(panel.getByRole('status')).toHaveText('8 issues found.');
    expect(await labels(targetSize.getByRole('list', { name: /^Elements:/ }))).toEqual(background);
    expect(await labels(review)).toEqual(backgroundReview);

    // Its comment says a person needs to judge it
    const created = nextCreate(page, project);
    await contrast.getByRole('listitem').filter({ hasText: 'p#gradient-note' }).getByRole('button', { name: 'Comment', exact: true }).click();
    const body = (await created).postDataJSON();
    expect(body.text).toMatch(/^Accessibility \(to review\): Elements must meet minimum color contrast ratio thresholds\.\nElement: `#gradient-note`\naxe-core could not decide:\n- Element's background color could not be determined due to a background gradient\n\nA person needs to check this\. WCAG 1\.4\.3 \(AA\)\. Rule color-contrast: https:\/\/dequeuniversity\.com\/rules\/axe\/[\d.]+\/color-contrast$/);
    expect(body.check).toEqual({ type: 'accessibility', id: 'color-contrast' });
    await expect(contrast).toContainText(/Comment posted as #1/);
    // Still not an issue: the button's count is the same
    await expect(button).toHaveAccessibleName('Accessibility, 8 issues found');

    await animationsFinished(panel);
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });
});

test('one comment for all of a rule\'s or a check\'s elements, listed within the limit, stays reported after a reload', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(120_000);
    const project = await memberReview(page, 'report-group', '?many');
    await backgroundIssues(page);
    await toolbar(page).getByRole('button', { name: /^Accessibility/ }).click();
    const panel = accessibilityPanel(page);

    // A rule: pinned to its first element, its text lists them, the check says how many
    const images = panel.locator('[data-uier-rule="image-alt"]');
    let created = nextCreate(page, project);
    await images.getByRole('button', { name: /^Comment on all 3/ }).click();
    let body = (await created).postDataJSON();
    expect(body.check).toEqual({ type: 'accessibility', id: 'image-alt', count: 3 });
    expect(body.position.selector).toContain('gallery-1');
    expect(body.text).toMatch(/^Accessibility \(critical\): Images must have alternative text\.\nElement does not have an alt attribute\n3 elements:\n- `#gallery-1`\n- `#gallery-2`\n- `#gallery-3`\n\nWCAG 1\.1\.1 \(A\)\. Rule image-alt: https:\/\/dequeuniversity\.com\/rules\/axe\/[\d.]+\/image-alt$/);
    await expect(images.getByRole('listitem')).toHaveCount(3);
    for (const item of await images.getByRole('listitem').all()) await expect(item).toContainText(/Comment posted as #1/);
    await expect(images).toContainText(/Comment posted for 3 elements as #1/);
    // Its button is Show now, with the focus on it, described by its list
    const showAll = images.locator('[data-uier-comment-all]');
    await expect(showAll).toHaveAccessibleName('Show');
    await expect(showAll).toHaveAccessibleDescription('Elements: Images must have alternative text');
    await expect(showAll).toBeFocused();
    await expect(commentBubble(page, 1, 1)).toBeVisible();

    // More elements than 1000 characters can list: as many as fit, then how many more
    const targets = panel.locator('[data-uier-rule="target-size"]');
    created = nextCreate(page, project);
    await targets.getByRole('button', { name: /^Comment on all 45/ }).click();
    body = (await created).postDataJSON();
    expect(body.check).toEqual({ type: 'accessibility', id: 'target-size', count: 45 });
    expect(body.text.length).toBeLessThanOrEqual(1000);
    expect(body.text).toMatch(/^Accessibility \(serious\): All touch targets must be 24px large, or leave sufficient space\.\n45 elements:\n- `#tool-bold`: Target has insufficient size/);
    expect(body.text).toMatch(/\n- and \d+ more\n\nWCAG 2\.5\.8 \(AA\)\. Rule target-size: https:\/\/dequeuniversity\.com\/rules\/axe\/[\d.]+\/target-size$/);
    await expect(targets).toContainText(/Comment posted for 45 elements as #2/);

    // The faint lines' contrast: the same rule as the gradient to review, another list
    const contrast = panel.locator('[data-uier-impact="serious"] [data-uier-rule="color-contrast"]');
    created = nextCreate(page, project);
    await contrast.getByRole('button', { name: /^Comment on all 2/ }).click();
    body = (await created).postDataJSON();
    expect(body.check).toEqual({ type: 'accessibility', id: 'color-contrast', count: 2 });
    expect(body.text).toMatch(/^Accessibility \(serious\): Elements must meet minimum color contrast ratio thresholds\.\nElement has insufficient color contrast of [^\n]+\n2 elements:\n- `#fine-print-1`\n- `#fine-print-2`\n\nWCAG 1\.4\.3 \(AA\)\./);
    await expect(contrast).toContainText(/Comment posted for 2 elements as #3/);

    // An SEO check with several elements gets it from the same list
    await toolbar(page).getByRole('button', { name: /^SEO/ }).click();
    const seo = seoPanel(page);
    const alt = seo.locator('[data-uier-check="alt"]');
    created = nextCreate(page, project);
    await alt.getByRole('button', { name: /^Comment on all 3/ }).click();
    body = (await created).postDataJSON();
    expect(body.check).toEqual({ type: 'seo', id: 'alt', count: 3 });
    expect(body.text).toBe('SEO (Alt text): 3 images without alt text.\n3 elements:\n- `#gallery-1` Image: `data:image/png`\n- `#gallery-2` Image: `data:image/png`\n- `#gallery-3` Image: `data:image/png`');
    await expect(alt).toContainText(/Comment posted for 3 elements as #4/);

    // After a reload every element it covered is reported, for anyone: no second comment
    await page.reload();
    await expect(alt.getByRole('listitem').filter({ hasText: 'Reported as #4' })).toHaveCount(3);
    await expect(alt.getByRole('button', { name: /^Comment/ })).toHaveCount(0);
    await toolbar(page).getByRole('button', { name: /^Accessibility/ }).click();
    await expect(panel.getByRole('status')).toHaveText(/issues found\.$/, { timeout: 30_000 });
    await expect(images.getByRole('listitem').filter({ hasText: 'Reported as #1' })).toHaveCount(3);
    await expect(images.getByRole('button', { name: /^Comment/ })).toHaveCount(0);
    await targets.getByRole('button', { name: 'Show all 45' }).click();
    await expect(targets.getByRole('listitem').filter({ hasText: 'Reported as #2' })).toHaveCount(45);
    await expect(contrast.getByRole('listitem').filter({ hasText: 'Reported as #3' })).toHaveCount(2);
    // That comment is pinned to a faint line: what axe-core could not decide of the same rule is not covered
    await expect(panel.locator('[data-uier-review] [data-uier-rule="color-contrast"]').getByRole('listitem').filter({ hasText: 'p#gradient-note' })
        .getByRole('button', { name: 'Comment', exact: true })).toBeVisible();

    await animationsFinished(panel);
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });
});

test('on a phone the rows keep their actions in the panel, and Not an issue and Comment on all take a tap', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.use.isMobile, 'Phone layout');
    test.setTimeout(90_000);
    const project = await memberReview(page, 'report-mobile');
    await toolbar(page).getByRole('button', { name: 'Options', exact: true }).tap();
    const options = page.getByRole('dialog', { name: 'Options' });
    await expect(options.getByRole('button', { name: /^SEO, \d+ to look at$/ })).toBeVisible({ timeout: 30_000 });
    await options.getByRole('button', { name: /^SEO/ }).tap();
    const seo = seoPanel(page);
    const alt = seo.locator('[data-uier-check="alt"]');
    // Every row keeps its three actions inside the panel, each 44 px to tap
    const panelBox = (await seo.boundingBox())!;
    await expect(alt.getByRole('button', { name: 'Not an issue' })).toHaveCount(3);
    for (const button of await alt.getByRole('button', { name: 'Not an issue' }).all()) {
        const box = (await button.boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + panelBox.width);
        expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await alt.getByRole('listitem').filter({ hasText: 'img#gallery-1' }).getByRole('button', { name: 'Not an issue' }).tap();
    await expect(alt.locator('summary', { hasText: 'Dismissed' })).toHaveText('Dismissed 1');
    // One comment for the two still counted
    const created = nextCreate(page, project);
    await alt.getByRole('button', { name: /^Comment on all 2/ }).tap();
    expect((await created).postDataJSON().check).toEqual({ type: 'seo', id: 'alt', count: 2 });
    await expect(alt).toContainText(/Comment posted for 2 elements as #1/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await animationsFinished(seo);
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });
});

test('Not an issue leaves the counts and the dot in this browser, is kept after a reload and can be restored', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(90_000);
    await memberReview(page, 'report-dismiss');
    const button = toolbar(page).getByRole('button', { name: /^Accessibility/ });
    const issues = await backgroundIssues(page);
    await button.click();
    const panel = accessibilityPanel(page);
    const images = panel.locator('[data-uier-rule="image-alt"]');
    const row = (list: Locator, name: string) => list.getByRole('list', { name: /^Elements:/ }).getByRole('listitem').filter({ hasText: name });

    // Out of the list, the counts and the button's name; the focus goes to the next element's action
    await row(images, 'img#gallery-2').getByRole('button', { name: 'Not an issue' }).click();
    await expect(row(images, 'img#gallery-2')).toHaveCount(0);
    await expect(row(images, 'img#gallery-3').getByRole('button', { name: 'Not an issue' })).toBeFocused();
    await expect(panel.getByRole('status')).toHaveText(`${issues - 1} issues found.`);
    await expect(panel.locator('[data-uier-summary="critical"] [data-uier-summary-count]')).toHaveText('2');
    await expect(button).toHaveAccessibleName(`Accessibility, ${issues - 1} issues found`);
    await expect(button.locator('[data-uier-attention="accessibility"]')).toBeVisible();
    // Folded under its list, said to be this browser's only
    const fold = images.locator('summary', { hasText: 'Dismissed' });
    await expect(fold).toHaveText('Dismissed 1');
    await expect(images.getByRole('list', { name: /^Dismissed:/ })).toBeHidden();

    // An SEO finding about the page: its check becomes a note, out of the count
    await toolbar(page).getByRole('button', { name: /^SEO/ }).click();
    const seo = seoPanel(page);
    const seoButton = toolbar(page).getByRole('button', { name: /^SEO/ });
    const toLook = Number(await seo.locator('[data-uier-summary="warn"] [data-uier-summary-count]').innerText());
    await expect(seoButton).toHaveAccessibleName(`SEO, ${toLook} to look at`);
    const description = seo.locator('[data-uier-check="description"]');
    await description.getByRole('button', { name: 'Not an issue' }).click();
    await expect(description).toHaveAttribute('data-uier-check-state', 'none');
    await expect(description.locator('summary', { hasText: 'Dismissed' })).toBeFocused();
    await expect(seo.locator('[data-uier-summary="warn"] [data-uier-summary-count]')).toHaveText(String(toLook - 1));
    await expect(seoButton).toHaveAccessibleName(`SEO, ${toLook - 1} to look at`);

    // Kept in this browser: the next page load counts without them
    await page.reload();
    await expect(seoButton).toHaveAccessibleName(`SEO, ${toLook - 1} to look at`);
    await expect(description).toHaveAttribute('data-uier-check-state', 'none');
    await expect(button).toHaveAccessibleName(`Accessibility, ${issues - 1} issues found`, { timeout: 30_000 });
    expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('uier:checks-dismissed:v1:')).length)).toBe(1);

    // Restore counts it again, and the focus stays in its list
    await button.click();
    await fold.click();
    await expect(images.getByText('Hidden in this browser only.')).toBeVisible();
    await animationsFinished(panel);
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });
    await images.getByRole('list', { name: /^Dismissed:/ }).getByRole('button', { name: 'Restore' }).click();
    await expect(row(images, 'img#gallery-2')).toBeVisible();
    await expect(fold).toHaveCount(0);
    await expect(images.getByRole('button', { name: 'Not an issue' }).first()).toBeFocused();
    await expect(panel.getByRole('status')).toHaveText(`${issues} issues found.`);
    await expect(button).toHaveAccessibleName(`Accessibility, ${issues} issues found`);
});
