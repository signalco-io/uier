import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, signIn, uniqueEmail } from './support/app';
import { longAlt } from './support/fixtures/content';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished, openPageCheck, pageCheckName, pageChecksButton, showChecksTab, toolbar } from './support/toolbar';

// The Accessibility panel's Alt text, Zoom and text spacing, and Motion sections
// (packages/toolbar/docs/page-checks-content.md) on the reviewed site's `fixture-content` origin
// (e2e/support/fixtures/content.ts), with the install guide's Content-Security-Policy.

test.use({ actionTimeout: 15_000 });

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

const origin = () => site.origin('fixture-content');

/** The next comment the toolbar posts, with its body */
function nextCreate(page: Page, project: string) {
    return page.waitForRequest((request: Request) => request.method() === 'POST' && new URL(request.url()).pathname === `/api/review/${project}/comments`);
}

/** A member reviews the fixture page through the app's review link */
async function memberReview(page: Page, label: string, query = '') {
    await signIn(page, uniqueEmail(label));
    const project = await createProject(page, { urls: [origin()] });
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${origin()}/${project}/pricing${query}`)}`);
    await expect(toolbar(page)).toBeVisible();
    return project;
}

const accessibilityPanel = (page: Page) => page.getByRole('complementary', { name: 'Accessibility' });

async function openAccessibility(page: Page) {
    if (await pageChecksButton(page).count()) await openPageCheck(page, /^Accessibility/);
    else {
        await toolbar(page).getByRole('button', { name: 'Options', exact: true }).tap();
        await page.getByRole('dialog', { name: 'Options' }).getByRole('button', { name: /^Accessibility/ }).tap();
    }
    const panel = accessibilityPanel(page);
    await expect(panel.getByRole('status')).toHaveText(/^\d+ issues? found\.$/, { timeout: 20_000 });
    return panel;
}

const issueCount = (name: string | null) => Number(/(\d+) issues? found/.exec(name ?? '')?.[1] ?? Number.NaN);

/** What text spacing leaves on the page: the document's adopted sheets, and a paragraph's spacing */
const pageSpacing = (page: Page) => page.evaluate(() => {
    const paragraph = getComputedStyle(document.getElementById('spacing-paragraph')!);
    return { sheets: document.adoptedStyleSheets.length, margin: paragraph.marginBottom, letters: paragraph.letterSpacing, words: paragraph.wordSpacing, lines: paragraph.lineHeight };
});

/** The toolbar's own text: the pill's and the panel's sizes, and a heading's spacing */
async function toolbarText(page: Page, panel: Locator) {
    const box = async (locator: Locator) => {
        const { width, height } = (await locator.boundingBox())!;
        return { width, height };
    };
    const heading = panel.getByRole('heading', { name: 'Zoom and text spacing' });
    return {
        pill: await box(toolbar(page)),
        title: await box(panel.getByRole('heading', { name: 'Accessibility', exact: true })),
        heading: await box(heading),
        style: await heading.evaluate(element => {
            const style = getComputedStyle(element);
            return [style.letterSpacing, style.wordSpacing, style.lineHeight, style.marginBottom];
        }),
        host: await page.evaluate(() => {
            const style = getComputedStyle(document.getElementById('uier-toolbar')!);
            return [style.letterSpacing, style.wordSpacing, style.lineHeight];
        })
    };
}

test('the Alt text section lists every image with its alt text and flags the ones that say nothing', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(90_000);
    const project = await memberReview(page, 'alt-text');
    await expect(pageChecksButton(page)).toHaveAttribute('data-uier-attention-panels', /\baccessibility\b/, { timeout: 20_000 });
    const panel = await openAccessibility(page);
    await showChecksTab(panel, 'screenReader');
    const section = panel.locator('[data-uier-section="altText"]');
    const check = (id: string) => section.locator(`[data-uier-check="${id}"]`);

    // Each flag is a warning with an issue on its image; good alt text and "Logo" alone are not flagged
    await expect(section.getByRole('heading', { name: 'Alt text 10' })).toBeVisible();
    await expect(check('alt-text-file-name')).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(check('alt-text-file-name')).toContainText('An alt text looks like a file name.');
    // One image's alt text is the check's value
    await expect(check('alt-text-file-name')).toContainText('"IMG_4021.jpg"');
    await expect(check('alt-text-file-name').getByRole('listitem')).toHaveCount(1);
    await expect(check('alt-text-file-name')).toContainText('img#alt-file');
    await expect(check('alt-text-prefix')).toContainText('img#alt-prefix');
    await expect(check('alt-text-placeholder')).toContainText('img#alt-placeholder');
    await expect(check('alt-text-long')).toContainText('over 150 characters');
    await expect(check('alt-text-long')).toContainText('img#alt-long');
    await expect(section.locator('[data-uier-check]')).toHaveCount(4);
    for (const id of ['alt-good', 'alt-logo', 'alt-broken', 'alt-svg', 'alt-hidden'])
        await expect(section.locator('[data-uier-check]').filter({ hasText: `#${id}` })).toHaveCount(0);

    // Every image the page shows, in its order, with a thumbnail from the address the page loaded
    const images = section.getByRole('list', { name: 'Images and their alt text' }).getByRole('listitem');
    await expect(images).toHaveCount(8);
    await expect(images.nth(0)).toContainText('"Two people reviewing a page on a laptop"');
    await expect(images.nth(0)).toContainText('img#alt-good');
    const thumbnail = images.nth(0).locator('img');
    await expect(thumbnail).toHaveAttribute('src', `${origin()}/content/team-photo.png`);
    await expect(thumbnail).toHaveAttribute('alt', '');
    await expect(thumbnail).toHaveAttribute('loading', 'lazy');
    await expect(thumbnail).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(await thumbnail.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1);
    // A flagged image says so; an empty alt is decoration, for a person to confirm
    await expect(images.nth(1)).toContainText('Flagged above: "IMG_4021.jpg"');
    await expect(images.nth(5)).toHaveAttribute('data-uier-image', 'decorative');
    await expect(images.nth(5)).toContainText('Decorative');
    // An address that does not load shows the placeholder
    await expect(images.nth(7)).toContainText('img#alt-broken');
    await expect(images.nth(7).locator('img')).toHaveCount(0);
    await expect(images.nth(7).locator('svg rect')).toBeVisible();
    // The rest after "Show all"; the hidden image is not listed, the svg and the GIF are
    await section.getByRole('button', { name: 'Show all 10' }).click();
    await expect(images).toHaveCount(10);
    await expect(images.nth(8)).toContainText('"Growth since launch"');
    await expect(images.nth(8).locator('img')).toHaveCount(0);
    await expect(images.nth(9)).toContainText('img#loader-gif');
    await expect(section).not.toContainText('alt-hidden');

    // Highlight outlines the image on the page
    await images.nth(3).getByRole('button', { name: 'Highlight' }).click();
    await expect(images.nth(3).getByRole('button', { name: 'Highlight' })).toHaveAttribute('aria-pressed', 'true');
    const outline = page.locator('[data-uier-check-highlight]');
    await expect(outline).toBeVisible();
    const [outlineBox, imageBox] = [await outline.boundingBox(), await page.locator('#alt-placeholder').boundingBox()];
    expect(Math.abs(outlineBox!.x - imageBox!.x) + Math.abs(outlineBox!.y - imageBox!.y)).toBeLessThan(2);

    // One click posts the flag on its image
    let created = nextCreate(page, project);
    await check('alt-text-file-name').getByRole('button', { name: 'Comment' }).click();
    let body = (await created).postDataJSON();
    expect(body.text).toBe('Accessibility: This image\'s alt text looks like a file name. Screen readers read it out as written: describe what the image shows, or leave the alt empty if it is decoration.'
        + `\nAlt text: \`IMG_4021.jpg\`\nImage: \`${origin()}/content/IMG_4021.jpg\``);
    expect(body.check).toEqual({ type: 'accessibility', id: 'alt-text-file-name' });
    expect(body.position.selector).toContain('alt-file');
    await expect(check('alt-text-file-name')).toContainText(/Comment posted as #1/);
    created = nextCreate(page, project);
    await check('alt-text-long').getByRole('button', { name: 'Comment' }).click();
    body = (await created).postDataJSON();
    expect(body.text).toContain('Accessibility: This image\'s alt text is over 150 characters.');
    expect(body.text).toContain(`\nAlt text: \`${longAlt}\``);
    expect(body.text.length).toBeLessThanOrEqual(1000);
    expect(body.check).toEqual({ type: 'accessibility', id: 'alt-text-long' });

    // The flags count on the button: the audit's issues and the four flags (the panel's other sections add theirs)
    const audit = issueCount(await panel.getByRole('status').textContent());
    const sections = await panel.locator('[data-uier-section="reflow"], [data-uier-section="motion"]').locator('[data-uier-check-state="warn"] li').count();
    await expect.poll(() => pageCheckName(page, /^Accessibility/)).toBe(`Accessibility, ${audit + 4 + sections} issues found`);

    await animationsFinished(panel);
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });
});

test('reflow names what sticks out at this width, and text spacing stays on until any way out of it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout; the phone test is below');
    test.setTimeout(120_000);
    const project = await memberReview(page, 'reflow');
    let panel = await openAccessibility(page);
    await showChecksTab(panel, 'visual');
    const section = panel.locator('[data-uier-section="reflow"]');
    const reflow = section.locator('[data-uier-check="reflow"]');

    // Measured at this window's width, said so, with the width WCAG asks for
    const by = await page.evaluate(() => Math.round(document.getElementById('content-wide')!.getBoundingClientRect().right + scrollX - document.documentElement.clientWidth));
    await expect(reflow).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(reflow).toContainText('1280 px');
    await expect(reflow).toContainText(`The page scrolls sideways. 1 element sticks out by ${by} px.`);
    await expect(reflow).toContainText('Checked at 1280 px. WCAG 1.4.10 asks for 320 px (1280 px at 400% zoom): narrow the window or zoom in, then check again.');
    await expect(reflow.getByRole('listitem')).toHaveCount(1);
    await expect(reflow.getByRole('listitem')).toContainText('div#content-wide');
    // Not what scrolls in its own box, nor a fixed element
    await expect(section).not.toContainText('content-scrolled');
    await expect(section).not.toContainText('content-fixed');
    let created = nextCreate(page, project);
    await reflow.getByRole('button', { name: 'Comment' }).click();
    let body = (await created).postDataJSON();
    expect(body.text).toBe(`Accessibility: At 1280 px wide, this element sticks out ${by} px past the page's edge, so the page scrolls sideways. WCAG 1.4.10 (Reflow) asks for no sideways scrolling at 320 px.\nElement: \`div#content-wide.content-wide\``);
    expect(body.check).toEqual({ type: 'accessibility', id: 'reflow' });
    expect(body.position.selector).toContain('content-wide');

    // Text spacing: off until asked for
    const spacing = section.locator('[data-uier-check="text-spacing"]');
    const toggle = section.getByRole('button', { name: 'Apply text spacing' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(spacing).toHaveAttribute('data-uier-check-state', 'none');
    const off = await pageSpacing(page);
    const toolbarBefore = await toolbarText(page, panel);

    // On: the criterion's values on the page, the text that no longer fits, and the toolbar as it was
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(spacing).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(spacing).toContainText('3 elements no longer fit their text.');
    const on = await pageSpacing(page);
    expect(on).toEqual({ sheets: off.sheets + 1, margin: '32px', letters: '1.92px', words: '2.56px', lines: '24px' });
    expect(await toolbarText(page, panel)).toEqual(toolbarBefore);
    const rows = spacing.getByRole('listitem');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Cut off: "Plans renew every month. Cancel at any time."');
    await expect(rows.nth(0)).toContainText('div#spacing-clip');
    await expect(rows.nth(1)).toContainText('Spills out: "Every plan includes the toolbar. Reviews never expire."');
    await expect(rows.nth(2)).toContainText('div#spacing-nowrap');
    // Not text that was cut off before, nor a box that scrolls
    await expect(spacing).not.toContainText('spacing-already');
    await expect(spacing).not.toContainText('spacing-scroll');
    created = nextCreate(page, project);
    await rows.nth(0).getByRole('button', { name: 'Comment' }).click();
    body = (await created).postDataJSON();
    expect(body.text).toBe('Accessibility: With WCAG 1.4.12 text spacing (line height 1.5, paragraph spacing 2 em, letter spacing 0.12 em, word spacing 0.16 em), this element\'s text no longer fits: it is cut off. It fits without it. Let the box grow with its text instead of a fixed height or width.'
        + '\nElement: `div#spacing-clip.content-box.content-clip`\nText: `Plans renew every month. Cancel at any time.`');
    expect(body.check).toEqual({ type: 'accessibility', id: 'text-spacing' });
    expect(body.position.selector).toContain('spacing-clip');
    await expect(rows.nth(0)).toContainText(/Comment posted as #2/);

    // Off with the toggle: nothing left on the page
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(spacing).toHaveAttribute('data-uier-check-state', 'none');
    expect(await pageSpacing(page)).toEqual(off);

    // Closing the panel
    await toggle.click();
    await expect(spacing).toHaveAttribute('data-uier-check-state', 'warn');
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    expect(await pageSpacing(page)).toEqual(off);

    // Check again
    panel = await openAccessibility(page);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(spacing).toHaveAttribute('data-uier-check-state', 'warn');
    await panel.getByRole('button', { name: 'Check again' }).click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(await pageSpacing(page)).toEqual(off);

    // Collapsing the toolbar
    await toggle.click();
    await expect(spacing).toHaveAttribute('data-uier-check-state', 'warn');
    await toolbar(page).getByRole('button', { name: 'Collapse toolbar' }).click();
    await expect.poll(() => pageSpacing(page)).toEqual(off);
    await page.getByRole('button', { name: /^Expand toolbar/ }).click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(await pageSpacing(page)).toEqual(off);

    // Leaving the page (a client-side navigation): the section unmounts with the panel's page
    await toggle.click();
    await expect(spacing).toHaveAttribute('data-uier-check-state', 'warn');
    await page.evaluate(() => history.pushState({}, '', `${location.pathname}/annual${location.search}`));
    await expect.poll(() => pageSpacing(page)).toEqual(off);

    // Cancelled: closed while it is being applied, it is never left on
    await expect(panel.getByRole('status')).toHaveText(/^\d+ issues? found\.$/, { timeout: 20_000 });
    await toggle.click();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await page.waitForTimeout(500);
    expect(await pageSpacing(page)).toEqual(off);
});

test('the Motion section lists what moves for more than five seconds, without the toolbar, and its notes', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(90_000);
    const project = await memberReview(page, 'motion');
    const panel = await openAccessibility(page);
    await showChecksTab(panel, 'visual');
    const section = panel.locator('[data-uier-section="motion"]');
    const check = (id: string) => section.locator(`[data-uier-check="${id}"]`);

    // Running animations that never end or run longer than five seconds; not the short one, not the toolbar's spinners
    await expect(check('motion-animation')).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(check('motion-animation')).toContainText('2 elements animate for more than five seconds.');
    const animated = check('motion-animation').getByRole('listitem');
    await expect(animated).toHaveCount(2);
    await expect(animated.nth(0)).toContainText('Animates without end');
    await expect(animated.nth(0)).toContainText('span#motion-pulse');
    await expect(animated.nth(1)).toContainText('Animates for 30 s');
    await expect(section).not.toContainText('motion-fade');
    await expect(section).not.toContainText('marquee');
    // The marquee is the audit's own rule, in the Issues tab
    await showChecksTab(panel, 'issues');
    await expect(panel.locator('[data-uier-rule="marquee"]')).toBeVisible();
    await showChecksTab(panel, 'visual');

    // Players that start on their own without controls: the video on its element, the audio about the page
    await expect(check('motion-media')).toContainText('2 players play on their own without controls.');
    await expect(check('motion-media').getByRole('listitem').filter({ hasText: 'video#content-video' })).toContainText('Video plays on its own in a loop');
    await expect(check('motion-media').getByRole('listitem').filter({ hasText: 'Audio plays on its own in a loop' })).toHaveCount(1);
    // GIFs, which may animate, and whether the page has a reduced-motion rule: notes
    await expect(check('motion-gif')).toHaveAttribute('data-uier-check-state', 'none');
    await expect(check('motion-gif')).toContainText('1 GIF image, by address.');
    await expect(check('motion-reduced')).toHaveAttribute('data-uier-check-state', 'none');
    await expect(check('motion-reduced')).toContainText('No prefers-reduced-motion rule found in the stylesheets this page lets us read.');

    const created = nextCreate(page, project);
    await animated.nth(0).getByRole('button', { name: 'Comment' }).click();
    const body = (await created).postDataJSON();
    expect(body.text).toBe('Accessibility: This element animates without end. WCAG 2.2.2 asks for a way to pause, stop or hide motion that starts on its own and lasts more than five seconds: check that the page offers one, or stop it within five seconds.'
        + '\nAnimation: `content-pulse`\nElement: `span#motion-pulse.motion-pulse`');
    expect(body.check).toEqual({ type: 'accessibility', id: 'motion-animation' });
    expect(body.position.selector).toContain('motion-pulse');
    await expect(animated.nth(0)).toContainText(/Comment posted as #1/);

    await animationsFinished(panel);
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });

    // A readable stylesheet with a reduced-motion rule is found on Check again
    await page.evaluate(() => {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync('@supports (display: grid) { @media (prefers-reduced-motion: reduce) { .motion-pulse { animation: none; } } }');
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    });
    await panel.getByRole('button', { name: 'Check again' }).click();
    await expect(check('motion-reduced')).toContainText('The page\'s stylesheets have a prefers-reduced-motion rule.');
});

test('on a phone the reflow row says it was checked at the screen\'s width', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.use.isMobile, 'Phone layout');
    test.setTimeout(90_000);
    // The page clips what sticks out: a page that scrolls sideways widens a phone's layout viewport, and the toolbar's fixed controls with it
    await memberReview(page, 'reflow-mobile', '?clip');
    const panel = await openAccessibility(page);
    await showChecksTab(panel, 'visual');
    const width = await page.evaluate(() => document.documentElement.clientWidth);
    expect(width).toBe(page.viewportSize()!.width);
    const by = await page.evaluate(() => Math.round(document.getElementById('content-wide')!.getBoundingClientRect().right + scrollX - document.documentElement.clientWidth));
    const reflow = panel.locator('[data-uier-check="reflow"]');
    await expect(reflow).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(reflow).toContainText(`${width} px`);
    await expect(reflow).toContainText(`1 element sticks out by ${by} px and is cut off.`);
    await expect(reflow).toContainText(`Checked at ${width} px, this screen's width. WCAG 1.4.10 asks for 320 px.`);
    await expect(reflow).toContainText('div#content-wide');
    await expect(panel.getByRole('button', { name: 'Apply text spacing' })).toBeVisible();
    // The panel fits the screen
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await animationsFinished(panel);
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });
});
