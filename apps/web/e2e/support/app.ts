import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// The signed-in app against `next start` with UIER_LOCAL=1: no email is sent, so the sign-in page
// shows the link it would have emailed ("Open the sign-in link"), and the stores are in memory.

/** A new address for every call, so tests never share a user */
export function uniqueEmail(label = 'e2e') {
    return `${label}-${randomUUID().slice(0, 8)}@example.com`;
}

/** Signs in (creating the user on first use) and waits for the page after sign-in */
export async function signIn(page: Page, email: string, { from = '/app/sign-in' } = {}) {
    await page.goto(from);
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.getByRole('status')).toContainText(`We sent a sign-in link to ${email}`);
    await page.getByRole('link', { name: 'Open the sign-in link' }).click();
    await expect(page.getByText(`Continue as ${email}.`)).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).not.toHaveURL(/\/app\/sign-in/);
}

/** Creates a project from /app/projects/new and returns its code (the install page follows) */
export async function createProject(page: Page, { urls, name }: { urls: string[]; name?: string }) {
    await page.goto('/app/projects/new');
    const [main, ...others] = urls;
    await page.getByLabel('Main site address').fill(main ?? '');
    for (const [index, url] of others.entries()) {
        await page.getByRole('button', { name: 'Add another address' }).click();
        await page.getByLabel(`Address ${index + 2}`, { exact: true }).fill(url);
    }
    if (name)
        await page.getByLabel('Project name').fill(name);
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.waitForURL(/\/app\/projects\/[0-9a-z]{12}\/install$/);
    const projectId = /\/app\/projects\/([0-9a-z]{12})\/install$/.exec(page.url())?.[1];
    if (!projectId)
        throw new Error(`No project id in ${page.url()}`);
    return projectId;
}

export type ProjectAccessLabel = 'Invited people' | 'Anyone with the link' | 'Comments off';

/** Sets who can comment on a project, from its settings */
export async function setProjectAccess(page: Page, projectId: string, label: ProjectAccessLabel) {
    await page.goto(`/app/projects/${projectId}/settings`);
    const access = page.getByRole('region', { name: 'Who can comment' });
    await access.getByRole('radio', { name: label }).click();
    await access.getByRole('button', { name: 'Save' }).click();
    await expect(access.getByRole('status')).toContainText('Saved.');
}

/** The sidebar as a sheet (small screens), while it is open or closing */
const sidebarSheet = (page: Page) => page.locator('[data-slot="sidebar"][data-mobile="true"]');

/** Waits for running animations (the sheet sliding in), so axe sees the final colours */
async function animationsDone(page: Page) {
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
}

/** The app's sidebar navigation; on small screens the sidebar is a sheet, opened first */
export async function appNavigation(page: Page) {
    const navigation = page.getByRole('navigation', { name: 'App' });
    const toggle = page.getByRole('button', { name: 'Toggle sidebar' });
    // A sheet that is still closing (after a link) can't be used
    await expect(sidebarSheet(page).and(page.locator('[data-state="closed"]'))).toHaveCount(0);
    if (!await navigation.isVisible() && await toggle.isVisible())
        await toggle.click();
    await expect(navigation).toBeVisible();
    await animationsDone(page);
    return navigation;
}

/** Closes the sidebar sheet on small screens (links close it themselves) and waits until it is gone */
export async function closeAppNavigation(page: Page) {
    const sheet = sidebarSheet(page);
    if (await sheet.count() && await sheet.getAttribute('data-state') === 'open')
        await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
}
