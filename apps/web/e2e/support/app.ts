import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

// The signed-in app against `next start` with UIER_LOCAL=1: no email is sent, so the sign-in page
// shows the link and code it would have emailed, and the stores are in memory.

/** A new address for every call, so tests never share a user */
export function uniqueEmail(label = 'e2e') {
    return `${label}-${randomUUID().slice(0, 8)}@example.com`;
}

/** Opens the email form, the sign-in page's last option, unless it is already open (`?with=email`). */
export async function openEmailSignIn(page: Page) {
    const field = page.getByLabel('Email', { exact: true });
    const option = page.getByRole('link', { name: 'Sign in with email' });
    await expect(field.or(option)).toBeVisible();
    // Before hydration the link navigates to ?with=email, after it the form opens in place.
    if (await option.isVisible())
        await option.click();
    return field;
}

/** Requests an email from the current sign-in page; local deployments show both credentials. */
export async function requestSignInEmail(page: Page, email: string) {
    await (await openEmailSignIn(page)).fill(email);
    await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
    await expect(page.getByRole('status')).toContainText(`We sent a code and a sign-in link to ${email}`);
    const code = await page.locator('[data-sign-in-code]').textContent();
    const link = await page.getByRole('link', { name: 'Open the sign-in link' }).getAttribute('href');
    expect(code).toMatch(/^\d{8}$/);
    expect(link).toMatch(/^\/app\/sign-in\/confirm\?token=/);
    return { code: code!, link: link! };
}

/**
 * Signs in with the browser-bound code and waits for the page after sign-in. A new account's first visit
 * to /app is the first-run step (name and workspace): `welcome: 'skip'` (the default) skips it, `'stay'`
 * stays on it.
 */
export async function signIn(page: Page, email: string, { from = '/app/sign-in', welcome = 'skip' }: { from?: string; welcome?: 'skip' | 'stay' } = {}) {
    await page.goto(from);
    const { code } = await requestSignInEmail(page, email);
    await page.getByLabel('Sign-in code', { exact: true }).fill(code);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    // /app redirects again to the first-run step, onboarding or projects. Wait for the final page before a goto.
    await page.waitForURL(url => url.pathname !== '/app' && !url.pathname.startsWith('/app/sign-in'));
    if (welcome === 'skip')
        await skipWelcome(page);
}

/** Skips the first-run step when the page is on it, and waits for the page after it */
export async function skipWelcome(page: Page) {
    if (new URL(page.url()).pathname !== '/app/welcome')
        return;
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await page.waitForURL(url => url.pathname !== '/app' && url.pathname !== '/app/welcome');
}

/** Creates a project from /app/projects/new and returns its id (onboarding's first step, the script, follows) */
export async function createProject(page: Page, { urls, name, clientName }: { urls: string[]; name?: string; clientName?: string }) {
    await page.goto('/app/projects/new');
    const [main, ...others] = urls;
    await page.getByLabel('Main site address').fill(main ?? '');
    // Typing in the last address adds the field for the next one
    for (const [index, url] of others.entries())
        await page.getByLabel(`Address ${index + 2}`, { exact: true }).fill(url);
    if (name)
        await page.getByLabel('Project name').fill(name);
    if (clientName !== undefined)
        await fillClientName(page.getByLabel('Client name (optional)'), clientName);
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.waitForURL(/\/app\/projects\/[0-9a-z]{12}\/install\?onboarding=1$/);
    const projectId = /\/app\/projects\/([0-9a-z]{12})\/install\?onboarding=1$/.exec(page.url())?.[1];
    if (!projectId)
        throw new Error(`No project id in ${page.url()}`);
    return projectId;
}

/** Opens one step of a new project's onboarding (`check`: the installation check, `invite`: the first reviewer) */
export async function openOnboardingStep(page: Page, projectId: string, step: 'script' | 'check' | 'invite') {
    await page.goto(`/app/projects/${projectId}/install?onboarding=1${step === 'script' ? '' : `&step=${step}`}`);
}

/** The independent id shown in generated guest links and embeds (legacy codes still resolve). */
export async function projectPublicId(page: Page, projectId: string) {
    const response = await page.request.get(`/api/review/${projectId}`);
    expect(response.status()).toBe(200);
    return (await response.json() as { project: { id: string } }).project.id;
}

/**
 * Types a project's client name and moves on with Tab, as people do. Tab closes the field's suggestions,
 * which hide the rest of the page from assistive technology while they are open.
 */
export async function fillClientName(field: Locator, value: string) {
    await field.fill(value);
    await field.press('Tab');
}

export type ProjectAccessLabel = 'Invited people' | 'Anyone with the link' | 'Comments off';

/**
 * Waits until React has hydrated the element, so it responds. Settings forms need it before the first
 * change: their Save stays off until React sees one.
 */
export async function hydrated(locator: Locator) {
    await expect.poll(() => locator.evaluate(element => Object.keys(element).some(key => key.startsWith('__reactProps$')))).toBe(true);
}

/** Sets who can comment on a project, from its Review settings (Save is off while nothing changed) */
export async function setProjectAccess(page: Page, projectId: string, label: ProjectAccessLabel) {
    await page.goto(`/app/projects/${projectId}/settings/review`);
    const review = page.getByRole('region', { name: 'Review', exact: true });
    const option = review.getByRole('radio', { name: label });
    if (await option.isChecked())
        return;
    await hydrated(review.locator('form'));
    await option.click();
    await review.getByRole('button', { name: 'Save', exact: true }).click();
    // The guest links' Copy buttons announce in status regions of their own
    await expect(review.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
}

/** The Review settings with Advanced open, where the page state is */
export async function pageStateSettings(page: Page) {
    const review = page.getByRole('region', { name: 'Review', exact: true });
    const field = review.getByLabel('Meaningful query fields');
    await hydrated(review.locator('form'));
    if (!await field.isVisible())
        await review.getByRole('button', { name: 'Advanced', exact: true }).click();
    await expect(field).toBeVisible();
    return review;
}

/** Opens the invite dialog from the project header: Invite is in the popover of who can comment */
export async function openProjectInvite(page: Page, access: ProjectAccessLabel = 'Invited people') {
    await page.getByRole('link', { name: access, exact: true }).hover();
    await page.getByRole('dialog', { name: access }).getByRole('button', { name: 'Invite', exact: true }).click();
}

/** The sidebar as a sheet (small screens), while it is open or closing */
const sidebarSheet = (page: Page) => page.locator('[data-slot="sidebar"][data-mobile="true"]');

/** Waits for running animations (the sheet sliding in), so axe sees the final colours */
async function animationsDone(page: Page) {
    await page.waitForFunction(() => document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).every(animation => animation.playState !== 'running'));
}

/** The app's sidebar navigation; on small screens the sidebar is a sheet, opened first */
export async function appNavigation(page: Page) {
    const navigation = page.getByRole('navigation', { name: 'App' });
    const toggle = page.getByRole('button', { name: 'Toggle sidebar' }).last();
    // A sheet that is still closing (after a link) can't be used
    await expect(sidebarSheet(page).and(page.locator('[data-closed]'))).toHaveCount(0);
    if (!await navigation.isVisible()) {
        await expect(toggle).toBeVisible();
        if (!await navigation.isVisible()) {
            await hydrated(toggle);
            await toggle.click();
        }
    }
    await expect(navigation).toBeVisible();
    await animationsDone(page);
    return navigation;
}

/** Closes the sidebar sheet on small screens (links close it themselves) and waits until it is gone */
export async function closeAppNavigation(page: Page) {
    const sheet = sidebarSheet(page);
    // Read atomically: a closing sheet can unmount between count() and getAttribute().
    if (await sheet.evaluateAll(elements => elements.some(element => element.hasAttribute('data-open'))))
        await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
}

/** The rows of a project's comments list (the inbox); each row's link opens its thread */
export const commentRows = (page: Page) => page.getByRole('list', { name: 'Comments', exact: true }).getByRole('listitem');

/**
 * A row's link by its number ("Comment #3 ...") or its first line. Only row links count, so `/^Comment/`
 * never matches the project's Comments tab.
 */
export function commentRowLink(scope: Page | Locator, row: number | string | RegExp) {
    const rowLinks = scope.getByRole('link', { name: /^Comment #\d+/ });
    return typeof row === 'number'
        ? scope.getByRole('link', { name: new RegExp(`^Comment #${row}(?!\\d)`) })
        : rowLinks.and(scope.getByRole('link', { name: row }));
}

/**
 * Opens a board card's Move from the keyboard, as a keyboard or screen reader user does: the card's
 * link takes the focus and M opens the menu of columns (pointers drag the card instead). Returns the menu.
 */
export async function openBoardMove(page: Page, card: number | string | RegExp, scope: Page | Locator = page) {
    // A card dropped a moment ago has settled: dnd-kit swallows clicks for 50 ms after a drop
    await expect(page.locator('[data-drag-preview]')).toHaveCount(0);
    await commentRowLink(scope, card).focus();
    await page.keyboard.press('m');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    return menu;
}

/**
 * Opens a thread from the comments list (or a board column) and returns it: the one `article`,
 * beside the list on wide screens, in the list's place on a phone, in a sheet on the board.
 */
export async function openComment(page: Page, row: number | string | RegExp) {
    await commentRowLink(page, row).first().click();
    const thread = page.getByRole('article');
    await expect(thread).toBeVisible();
    if (typeof row === 'number') await expect(thread).toContainText(`Comment #${row}`);
    return thread;
}

/**
 * From the next page load the window counts as in the background (`document.hasFocus()` is false), so an
 * open thread is not read by being shown (the app's `useReadWhenShown`, the toolbar's `CommentThread`).
 * For tests about other changes that hold, fail or count the page's server actions or check the unread
 * dot: they then see only their own writes, however long a step takes.
 */
export async function inBackground(page: Page) {
    await page.addInitScript(() => { Document.prototype.hasFocus = () => false; });
}

/** The floating bar of a project's selected comments: the actions, Select shown results and the outcome */
export const selectionBar = (page: Page) => page.getByRole('group', { name: 'Selected feedback actions', exact: true });

/** A thread's selection box in the list or on the board, by its number */
export const selectionBox = (page: Page, number: number) => page.getByRole('checkbox', { name: `Select comment #${number}`, exact: true });

/** The row (or board card) that holds a control, as a mouse hovers it */
export const rowOf = (control: Locator) => control.locator('xpath=ancestor::*[@data-comment-row][1]');

/**
 * Holds a finger on an element (its middle) until `held` passes, then lifts it: browser touch events, as a phone sends
 * them, so the browser's own long-press handling (its menu, text selection, the click after it) takes part too.
 */
export async function longPress(page: Page, target: Locator, held: () => Promise<unknown>) {
    // Waits until the finger would land on it (nothing over it, such as a closing sheet), without tapping
    await target.tap({ trial: true });
    const box = (await target.boundingBox())!;
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
    try { await held(); } finally {
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await session.detach();
    }
}

/**
 * Resolves once a board card held by a finger is ready to lift (`data-hold`, after 250 ms), at once, so the test can
 * move the finger before the long press (which selects the card instead) without waiting a fixed time
 */
export const heldForDrag = (card: Locator) => card.evaluate(element => new Promise<void>(resolve => {
    if (element.hasAttribute('data-hold')) return resolve();
    new MutationObserver((_, observer) => { if (element.hasAttribute('data-hold')) { observer.disconnect(); resolve(); } }).observe(element, { attributes: true });
}));

/** Whether the page is on a touch screen (a coarse pointer), where a long press on a row selects it */
const touchScreen = (page: Page) => page.evaluate(() => window.matchMedia('(pointer: coarse)').matches);

/**
 * Selects a thread by its box. With a mouse a box shows on hover, so this hovers its row first; on a touch screen it
 * starts with a long press on the row (its link), and while selecting a tap on the box toggles it.
 */
export async function selectBox(page: Page, box: Locator) {
    const row = rowOf(box);
    if (!await touchScreen(page)) {
        await row.hover();
        await box.check();
    } else if (await box.evaluate(element => getComputedStyle(element).pointerEvents === 'none')) {
        await longPress(page, row.getByRole('link').first(), () => expect(box).toBeChecked());
    } else await box.check();
    await expect(box).toBeChecked();
}

/** Checks a thread's selection box (see `selectBox`) */
export async function selectThread(page: Page, number: number) {
    await selectBox(page, selectionBox(page, number));
}

/** Checks Select shown results (or Select first 50 shown) in the selection bar, selecting the first shown thread to open it */
export async function selectShownResults(page: Page, name: 'Select shown results' | 'Select first 50 shown' = 'Select shown results') {
    await selectBox(page, page.getByRole('checkbox', { name: /^Select comment #/ }).first());
    await selectionBar(page).getByRole('checkbox', { name, exact: true }).check();
}

/** Opens the comments' Filter popover (priority, environment and page, people, unread) */
export async function openCommentFilters(page: Page) {
    await page.getByRole('button', { name: /^Filter ?\d*$/ }).click();
    const filters = page.getByRole('dialog', { name: 'Filter comments' });
    await expect(filters).toBeVisible();
    return filters;
}

/** Every comment's row link on the page, in the list or on the board */
export const allCommentRowLinks = (page: Page) => page.getByRole('link', { name: /^Comment(?: #\d+|:) / });

/** Back to the list where the open thread took its place (a phone); nothing to do beside the list */
export async function backToComments(page: Page) {
    const back = page.getByRole('button', { name: 'Back to comments', exact: true });
    const search = page.getByRole('searchbox', { name: 'Search feedback' });
    await expect(back.or(search).first()).toBeVisible();
    // A navigation (a filter) may close the thread on its own meanwhile
    if (await back.isVisible()) await back.click({ timeout: 5000 }).catch(() => undefined);
    await expect(search).toBeVisible();
}

/** The open thread's reply box: Reply opens it unless it is open already (it stays open through status changes) */
export async function openReply(thread: Locator) {
    const input = thread.getByRole('textbox', { name: 'Reply', exact: true });
    if (!(await input.isVisible())) await thread.getByRole('button', { name: 'Reply', exact: true }).click();
    return input;
}
