import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished, showChecksTab, toolbar, openPageCheck } from './support/toolbar';

// The Accessibility panel's Keyboard and Screen reader sections (packages/toolbar/docs/page-checks-keyboard.md)
// on a project's site on another origin (`fixture-keyboard`, e2e/support/fixtures/keyboard.ts): the tab
// order and its overlay, the manual focus indicator check started by keyboard and by mouse, and the
// screen reader outline from axe-core's own role and name functions.

test.use({ actionTimeout: 15_000 });

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

const fixtureOrigin = () => site.origin('fixture-keyboard');

/** The fixture's tab order: the positive tabindex first, the radio group's checked radio only, the shadow root's button in its host's place */
const tabOrder = ['#jump-ahead', '#skip-link', '#nav-plans', '#nav-docs', '#ghost-link', '#plan-team', '#shadow-button', '#no-ring', '#ring',
    '#wrapped', '#read-first', '#read-second', '#read-third', '#faq-toggle', '#bold', '#email', '#subscribe', '#footer-plans'];

/** The next comment the toolbar posts, with its body */
function nextCreate(page: Page, project: string) {
    return page.waitForRequest((request: Request) => request.method() === 'POST' && new URL(request.url()).pathname === `/api/review/${project}/comments`);
}

/** A member reviews the fixture page and opens the Accessibility panel; its Keyboard section has a report */
async function openPanel(page: Page, label: string) {
    await signIn(page, uniqueEmail(label));
    const project = await createProject(page, { urls: [fixtureOrigin()] });
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${fixtureOrigin()}/${project}/keyboard`)}`);
    await expect(toolbar(page)).toBeVisible();
    await openPageCheck(page, /^Accessibility/);
    const panel = page.getByRole('complementary', { name: 'Accessibility' });
    const keyboard = panel.locator('[data-uier-section="keyboard"]');
    await expect(keyboard).toHaveAttribute('data-uier-section-status', 'done', { timeout: 20_000 });
    await showChecksTab(panel, 'keyboard');
    // Show tab order and Check focus indicators, above the section
    const tools = panel.locator('[data-uier-keyboard-tools]');
    return { project, panel, keyboard, tools };
}

const check = (section: Locator, id: string) => section.locator(`[data-uier-check="${id}"]`);

/**
 * Where each stop's number is not where it should be: centred on its element's top-left corner (kept
 * 10 px inside the window), only for the stops in the window, numbered in the tab order
 */
function misplacedMarkers(page: Page) {
    return page.evaluate(order => {
        const layer = document.querySelector('#uier-toolbar')?.shadowRoot?.querySelector('[data-uier-tab-order]');
        const markers = new Map([...layer?.querySelectorAll('[data-uier-tab-stop]') ?? []]
            .map(marker => [Number(marker.getAttribute('data-uier-tab-stop')), marker.getBoundingClientRect()]));
        const problems: string[] = [];
        if (!layer) return ['no overlay'];
        let inView = 0;
        order.forEach((selector, index) => {
            const element = document.querySelector(selector) ?? document.querySelector('#shadow-host')!.shadowRoot!.querySelector(selector)!;
            const rect = element.getBoundingClientRect();
            const marker = markers.get(index + 1);
            if (!(rect.bottom >= 0 && rect.top <= innerHeight && rect.right >= 0 && rect.left <= innerWidth)) {
                if (marker) problems.push(`${index + 1} ${selector}: drawn out of view`);
                return;
            }
            inView++;
            const [x, y] = [Math.min(Math.max(rect.left, 10), innerWidth - 10), Math.min(Math.max(rect.top, 10), innerHeight - 10)];
            if (!marker) problems.push(`${index + 1} ${selector}: missing`);
            else if (Math.abs(marker.left + marker.width / 2 - x) > 1.5 || Math.abs(marker.top + marker.height / 2 - y) > 1.5) problems.push(`${index + 1} ${selector}: misplaced`);
        });
        if (markers.size !== inView) problems.push(`${markers.size} numbers for ${inView} stops in view`);
        return problems;
    }, tabOrder);
}

test('the Keyboard section reports the tab order and draws it on the page while the panel is open and the toolbar expanded', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(90_000);
    const { project, panel, keyboard, tools } = await openPanel(page, 'keyboard-order');

    // The order's size, the positive tabindex and the stop nobody can see; the skip link is left out of that
    await expect(check(keyboard, 'tab-stops')).toContainText(String(tabOrder.length));
    await expect(check(keyboard, 'tab-stops')).toHaveAttribute('data-uier-check-state', 'none');
    const jumps = check(keyboard, 'tab-positive-tabindex');
    await expect(jumps).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(jumps).toContainText('1 element jumps ahead of the page\'s order with a tabindex above 0.');
    await expect(jumps.getByRole('listitem')).toHaveCount(1);
    await expect(jumps.getByRole('listitem')).toContainText('button#jump-ahead');
    const hidden = check(keyboard, 'tab-hidden-stop');
    await expect(hidden).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(hidden).toContainText('1 stop takes the focus but cannot be seen (transparent). 1 hidden in-page link left out: it may show on focus');
    await expect(hidden.getByRole('listitem')).toHaveCount(1);
    await expect(hidden.getByRole('listitem')).toContainText('a#ghost-link.ghost');

    // The order on the page: numbered by its elements, following the scroll. Its button is above the section's findings
    const toggle = tools.getByRole('button', { name: 'Show tab order' });
    expect((await tools.boundingBox())!.y).toBeLessThan((await keyboard.boundingBox())!.y);
    await expect(tools).toContainText('Numbers each stop on the page, with a line to the next.');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    // Each tool's label stays inside its button, also wrapped in a narrow card
    for (const button of await tools.getByRole('button').all()) {
        expect(await button.evaluate(element => element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const layer = page.locator('[data-uier-tab-order]');
    await expect(layer.locator('[data-uier-tab-stop="1"]')).toHaveText('1');
    await expect(layer.locator('path')).toHaveCount(2);
    await expect(layer.locator('path').first()).toHaveAttribute('d', /^M[\d.]+ [\d.]+L/);
    await expect.poll(() => misplacedMarkers(page)).toEqual([]);
    // The skip link is off screen and the other radios are no stops of their own
    await expect(layer.locator('[data-uier-tab-stop="2"]')).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 260));
    await expect.poll(() => misplacedMarkers(page)).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));

    await animationsFinished(panel);
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });

    // Hidden with the review layer while the toolbar is collapsed
    await toolbar(page).getByRole('button', { name: 'Collapse toolbar' }).click();
    await expect(layer).toHaveCount(0);
    await page.getByRole('button', { name: /^Expand toolbar/ }).click();
    await expect.poll(() => misplacedMarkers(page)).toEqual([]);

    // A finding is one click from a comment on its element
    const created = nextCreate(page, project);
    await jumps.getByRole('listitem').getByRole('button', { name: 'Comment' }).click();
    const body = (await created).postDataJSON();
    expect(body.text).toBe('Accessibility: This element has tabindex="2", so the Tab key reaches it before the rest of the page, out of reading order. Use tabindex="0", or move it in the page.\nElement: `button#jump-ahead`\nText: `Jump ahead`');
    expect(body.check).toEqual({ type: 'accessibility', id: 'tab-positive-tabindex' });
    expect(body.position.selector).toContain('jump-ahead');
    await expect(jumps.getByRole('listitem')).toContainText(/Comment posted as #1/);

    // Gone with the panel, and off when it opens again
    await panel.getByRole('button', { name: 'Close Accessibility panel' }).click();
    await expect(panel).toBeHidden();
    await expect(layer).toHaveCount(0);
    await openPageCheck(page, /^Accessibility/);
    await expect(tools.getByRole('button', { name: 'Show tab order' })).toHaveAttribute('aria-pressed', 'false');
    await expect(layer).toHaveCount(0);
});

/** The focus check's results: the button without a focus style, and the stop that stays hidden; never the ring, the wrapper or the skip link */
async function expectFocusFindings(keyboard: Locator) {
    const indicators = check(keyboard, 'focus-indicator');
    await expect(indicators).toHaveAttribute('data-uier-check-state', 'warn', { timeout: 20_000 });
    await expect(indicators).toContainText(`1 of ${tabOrder.length} stops showed no visible change when focused.`);
    await expect(indicators.getByRole('listitem')).toHaveCount(1);
    await expect(indicators.getByRole('listitem')).toContainText('button#no-ring');
    const unseen = check(keyboard, 'focus-hidden');
    await expect(unseen).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(unseen).toContainText('1 stop cannot be seen even with the focus (transparent).');
    await expect(unseen.getByRole('listitem')).toHaveCount(1);
    await expect(unseen.getByRole('listitem')).toContainText('a#ghost-link.ghost');
    for (const label of ['button#ring', 'button#wrapped', 'a#skip-link']) await expect(keyboard).not.toContainText(label);
}

test('the focus check moves the focus through the page, by keyboard or by mouse, and puts the focus and the scroll back', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(90_000);
    const { project, panel, keyboard, tools } = await openPanel(page, 'keyboard-focus');
    const start = tools.getByRole('button', { name: 'Check focus indicators' });
    await expect(start).toHaveAccessibleDescription(/^Moves the focus through the page's controls/);
    // Not run when the panel opened: it changes the page while it runs
    await expect(check(keyboard, 'focus-indicator')).toHaveCount(0);

    // From the keyboard; the page is scrolled, and one of its focus handlers scrolls it to the top
    await page.evaluate(() => window.scrollTo(0, 150));
    await start.focus();
    await page.keyboard.press('Enter');
    await expectFocusFindings(keyboard);
    // Its description stays with the findings
    await expect(tools).toContainText("Moves the focus through the page's controls");
    await expect(tools.getByRole('status')).toHaveText(`1 of ${tabOrder.length} stops showed no visible change when focused.`);
    await expect(start).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(150);
    await expect(page.locator('#bold')).not.toBeFocused();

    await animationsFinished(panel);
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });

    // The finding's comment says what was found, on its element
    const created = nextCreate(page, project);
    await check(keyboard, 'focus-indicator').getByRole('listitem').getByRole('button', { name: 'Comment' }).click();
    const body = (await created).postDataJSON();
    expect(body.text).toBe('Accessibility: This element looks the same with and without the keyboard focus: its outline, border, shadow, background, text decoration and colour did not change. Give it a visible focus indicator (WCAG 2.4.7).\nElement: `button#no-ring`\nText: `No focus style`');
    expect(body.check).toEqual({ type: 'accessibility', id: 'focus-indicator' });

    // Check again drops it; a click starts it again, asking the browser for the keyboard's focus styles
    await panel.getByRole('button', { name: 'Check again' }).click();
    await expect(check(keyboard, 'focus-indicator')).toHaveCount(0);
    await expect(keyboard).toHaveAttribute('data-uier-section-status', 'done');
    // Posting scrolled the element into view for its screenshot
    await page.evaluate(() => window.scrollTo(0, 150));
    await tools.getByRole('button', { name: 'Check focus indicators' }).click();
    await expectFocusFindings(keyboard);
    await expect(start).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(150);
});

test('a focus check started by a click in a browser without focusVisible says it cannot tell, and runs from the keyboard', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(90_000);
    // A browser that ignores `focus({ focusVisible })`: after a click, a script's focus shows no keyboard focus styles
    await page.addInitScript(() => {
        const focus = HTMLElement.prototype.focus;
        HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions & { focusVisible?: boolean }) {
            focus.call(this, { preventScroll: options?.preventScroll });
        };
    });
    const { keyboard, tools } = await openPanel(page, 'keyboard-click');
    const start = tools.getByRole('button', { name: 'Check focus indicators' });
    await start.click();
    const indicators = check(keyboard, 'focus-indicator');
    await expect(indicators).toHaveAttribute('data-uier-check-state', 'none', { timeout: 20_000 });
    await expect(indicators).toContainText('Not checked: the browser showed no keyboard focus styles, since the check started with a click. Press Enter on Check focus indicators to start it from the keyboard.');
    await expect(indicators.getByRole('listitem')).toHaveCount(0);
    await expect(check(keyboard, 'focus-hidden')).toHaveCount(0);
    await expect(start).toBeFocused();

    // One key press, and the browser shows them
    await page.keyboard.press('Enter');
    await expectFocusFindings(keyboard);
    await expect(start).toBeFocused();
});

test('the Screen reader section lists landmarks, headings and controls with their names and states, and links that share a name', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'Desktop layout');
    test.setTimeout(90_000);
    const { project, panel } = await openPanel(page, 'screen-reader');
    const reader = panel.locator('[data-uier-section="screenReader"]');
    await expect(reader).toHaveAttribute('data-uier-section-status', 'done');
    await showChecksTab(panel, 'screenReader');

    await expect(check(reader, 'sr-landmarks')).toContainText('banner, navigation, main, region, contentinfo.');
    await expect(check(reader, 'sr-headings')).toContainText('Levels 1 to 4.');
    await expect(check(reader, 'sr-controls')).toContainText('8 links, 7 buttons and 5 other controls');
    for (const id of ['sr-landmarks', 'sr-headings', 'sr-controls']) await expect(check(reader, id)).toHaveAttribute('data-uier-check-state', 'none');
    // Three links named "Read more" go to different pages; the two "Plans" links go to the same one
    const sameName = check(reader, 'sr-same-name');
    await expect(sameName).toHaveAttribute('data-uier-check-state', 'warn');
    await expect(sameName).toContainText('3 links are named "Read more" but go to different addresses.');
    const sameNameItems = sameName.getByRole('listitem');
    await expect(sameNameItems).toHaveCount(3);
    for (const [index, post] of ['first', 'second', 'third'].entries()) {
        await expect(sameNameItems.nth(index)).toContainText(`Named "Read more", goes to /blog/${post}`);
        await expect(sameNameItems.nth(index)).toContainText(`a#read-${post}`);
    }

    // The outline, folded: landmarks with their names and headings with their levels, in reading order
    await reader.locator('summary', { hasText: 'Landmarks and headings' }).click();
    const structure = reader.getByRole('list', { name: 'Landmarks and headings' });
    await expect(structure.getByRole('listitem')).toHaveText([
        'banner No name', 'navigation Main', 'main No name', 'h1 Keyboard fixture', 'h2 Articles', 'h3 First post', 'h3 Second post',
        'h3 Third post', 'h4 Questions', 'region Sign up', 'contentinfo No name'
    ]);
    // Controls as role and name, with their states, the shadow root's button in its place, the toolbar left out
    await reader.locator('summary', { hasText: 'Controls' }).click();
    const controls = reader.getByRole('list', { name: 'Controls' });
    await expect(controls.getByRole('listitem')).toHaveText([
        'link Skip to content', 'link Plans', 'link Docs', 'button Jump ahead', 'link Hidden stop', 'radio Basic, not checked',
        'radio Team, checked', 'radio Scale, not checked', 'button Inside a shadow root', 'button No focus style', 'button Focus ring',
        'button Wrapper reacts', 'link Read more', 'link Read more', 'link Read more', 'button Show answers, collapsed', 'button Bold, pressed',
        'textbox Email, required, invalid', 'checkbox Send me news, checked', 'link Plans'
    ]);

    // Highlight outlines an item's element
    const heading = structure.getByRole('listitem').filter({ hasText: 'h1 Keyboard fixture' });
    await heading.getByRole('button', { name: 'Highlight' }).click();
    await expect(heading.getByRole('button', { name: 'Highlight' })).toHaveAttribute('aria-pressed', 'true');
    const outline = page.locator('[data-uier-check-highlight]');
    await expect(outline).toBeVisible();
    const [outlineBox, headingBox] = [await outline.boundingBox(), await page.locator('h1').boundingBox()];
    expect(Math.abs(outlineBox!.x - headingBox!.x) + Math.abs(outlineBox!.y - headingBox!.y)).toBeLessThan(2);

    await animationsFinished(panel);
    await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });

    // A shared name's comment names the link and where it goes
    const created = nextCreate(page, project);
    await sameName.getByRole('listitem').filter({ hasText: 'a#read-second' }).getByRole('button', { name: 'Comment' }).click();
    const body = (await created).postDataJSON();
    expect(body.text).toBe('Accessibility: 3 links on this page share this name but go to different addresses. Listed by name, as screen readers offer them, they cannot be told apart. Give each a name that says where it goes.\nLink text: `Read more`\nAddress: `/blog/second`');
    expect(body.check).toEqual({ type: 'accessibility', id: 'sr-same-name' });
    expect(body.position.selector).toContain('read-second');
});
