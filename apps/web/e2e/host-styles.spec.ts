import { expect, test, type Locator, type Page } from '@playwright/test';
import { createProject, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished, inboxSearch, openProfile, pageChecksButton, toolbar } from './support/toolbar';

// The toolbar looks the same on every site (packages/toolbar/docs/host-styles.md): on a project's page whose styles
// reach its shadow root every way they can (`fixture-host-styles`, e2e/support/fixtures/hostStyles.ts) the pill and a
// popover have the same boxes and styles as on the same page without them, and point mode outlines the element
// under the pointer where it is, despite the page's CSS zoom, also in a modal dialog whose zoom changes.

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

const fixtureOrigin = () => site.origin('fixture-host-styles');

/** Every computed style the page could change through inheritance, its rules or its custom properties */
const properties = ['font-family', 'font-size', 'font-style', 'font-weight', 'font-variant-caps', 'line-height', 'letter-spacing',
    'word-spacing', 'text-transform', 'text-indent', 'text-align', 'text-shadow', 'white-space', 'color', '-webkit-text-fill-color',
    '-webkit-font-smoothing', 'direction', 'color-scheme', 'forced-color-adjust', 'cursor', 'user-select', 'box-sizing', 'border-radius',
    'padding', 'gap', 'background-color', 'opacity', 'zoom'];

/** The boxes and styles of an element and everything in it, with its text selection colours and direction */
function looks(locator: Locator) {
    return locator.evaluate((element, properties) => [element, ...element.querySelectorAll('*')].map((part) => {
        const style = getComputedStyle(part);
        const selection = getComputedStyle(part, '::selection');
        const box = part.getBoundingClientRect();
        return {
            part: part.tagName.toLowerCase(),
            box: [box.x, box.y, box.width, box.height].map(value => Math.round(value * 10) / 10),
            ...Object.fromEntries(properties.map(property => [property, style.getPropertyValue(property)])),
            selection: `${selection.backgroundColor} ${selection.color}`,
            ltr: part.matches(':dir(ltr)')
        };
    }), properties);
}

/** The pill on the fixture page, plain or with the page's hostile styles, before anything is pressed */
async function reviewPill(page: Page, project: string, hostile: boolean) {
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${fixtureOrigin()}/${project}/pricing${hostile ? '?hostile' : ''}`)}`);
    await expect(toolbar(page)).toBeVisible();
    // On wide screens, the preview checks add the attention dot asynchronously on this fixture.
    const checks = pageChecksButton(page);
    if (await checks.isVisible()) await expect(checks).toHaveAccessibleName(/^Page checks, \d+ to look at$/);
    await page.mouse.move(0, 0);
    // The pointer may have rested on a button while the page loaded: its hover colour fades out over a few frames
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await animationsFinished(toolbar(page));
    return looks(toolbar(page));
}

/** The Profile popover (Options on a phone), opened from the pill and closed again */
async function profileLooks(page: Page) {
    const profile = await openProfile(page);
    await animationsFinished(profile);
    const popover = await looks(profile);
    await page.keyboard.press('Escape');
    await expect(profile).toBeHidden();
    return popover;
}

test('the toolbar looks the same on a page whose styles reach into it', async ({ page }, testInfo) => {
    await signIn(page, uniqueEmail('host-styles'));
    const project = await createProject(page, { urls: [fixtureOrigin()] });
    const pill = await reviewPill(page, project, false);
    const popover = await profileLooks(page);
    expect(await reviewPill(page, project, true)).toEqual(pill);
    expect(await profileLooks(page)).toEqual(popover);

    // Point mode outlines the heading where the page draws it, inside its CSS zoom
    if (testInfo.project.use.hasTouch) return;
    await page.getByRole('button', { name: 'Add comment', exact: true }).click();
    await expectOutlined(page, page.getByRole('heading', { name: 'Pricing' }));
});

test('a high-z-index page header cannot cover the inbox controls', async ({ page }) => {
    await signIn(page, uniqueEmail('host-styles-stacking'));
    const project = await createProject(page, { urls: [fixtureOrigin()] });
    await reviewPill(page, project, false);

    // Headers and banners can mount after the toolbar and use the largest z-index the browser accepts.
    await page.evaluate(() => {
        document.body.style.minHeight = '200vh';
        const header = document.createElement('button');
        header.textContent = 'Page header action';
        header.style.cssText = 'position: fixed; inset: 0 0 auto; height: 160px; z-index: 2147483647';
        header.addEventListener('click', () => { header.textContent = 'Page header clicked'; });
        document.body.appendChild(header);
        window.scrollTo(0, 300);
    });

    await toolbar(page).getByRole('button', { name: /^Inbox/ }).click();
    const inbox = page.getByRole('complementary', { name: 'Comments' });
    await expect(inbox).toBeVisible();
    await inboxSearch(inbox);
    await page.keyboard.press('Escape');
    await inbox.getByRole('button', { name: 'Close sidebar' }).click();
    await expect(inbox).toBeHidden();
    expect(await page.evaluate(() => window.scrollY)).toBe(300);

    await page.getByRole('button', { name: 'Page header action' }).click();
    await expect(page.getByRole('button', { name: 'Page header clicked' })).toBeVisible();
});

/** Point mode outlines the element under the pointer where the page draws it */
async function expectOutlined(page: Page, target: Locator) {
    const box = (await target.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(async () => {
        const outlined = await page.locator('[data-uier-outline]').boundingBox();
        return outlined && [outlined.x - box.x, outlined.y - box.y, outlined.width - box.width, outlined.height - box.height]
            .every(difference => Math.abs(difference) <= 1) ? 'outlined' : `off: ${JSON.stringify({ outlined, box })}`;
    }).toBe('outlined');
}

test('in a modal dialog whose zoom the page changes, the toolbar keeps its size and the page\'s coordinates', async ({ page }, testInfo) => {
    await signIn(page, uniqueEmail('host-styles-dialog'));
    const project = await createProject(page, { urls: [fixtureOrigin()] });
    const pill = await reviewPill(page, project, true);
    // The toolbar follows the page's open modal (src/modalLayer.ts), inside the page's zoom on <html>
    await page.locator('#plan-dialog').evaluate((dialog: HTMLDialogElement) => dialog.showModal());
    await expect(page.locator('#plan-dialog > #uier-toolbar')).toHaveCount(1);
    await expect.poll(() => looks(toolbar(page))).toEqual(pill);
    // The page zooms the dialog with a class, then with its style
    const dialog = page.getByRole('dialog', { name: 'Plan details' });
    await dialog.evaluate(element => element.classList.add('zoomed'));
    await expect.poll(() => looks(toolbar(page))).toEqual(pill);
    await dialog.evaluate((element: HTMLElement) => { element.style.zoom = '2'; });
    await expect.poll(() => looks(toolbar(page))).toEqual(pill);

    if (testInfo.project.use.hasTouch) return;
    await toolbar(page).getByRole('button', { name: 'Add comment', exact: true }).click();
    await expectOutlined(page, dialog.getByRole('heading', { name: 'Plan details' }));
});
