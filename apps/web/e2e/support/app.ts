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
    await expect(review.getByRole('status')).toContainText('Saved.');
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
    await page.getByRole('button', { name: access, exact: true }).click();
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
    const toggle = page.getByRole('button', { name: 'Toggle sidebar' });
    // A sheet that is still closing (after a link) can't be used
    await expect(sidebarSheet(page).and(page.locator('[data-closed]'))).toHaveCount(0);
    if (!await navigation.isVisible() && await toggle.isVisible())
        await toggle.click();
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

/** A row's link by its number ("Comment #3 ...") or its first line */
export function commentRowLink(scope: Page | Locator, row: number | string | RegExp) {
    return scope.getByRole('link', { name: typeof row === 'number' ? new RegExp(`^Comment #${row}(?!\\d)`) : row });
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
