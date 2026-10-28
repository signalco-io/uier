import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { animationsFinished } from './support/toolbar';

async function projectSettings(page: Page, baseURL: string) {
    await signIn(page, uniqueEmail('github-ui'));
    const projectId = await createProject(page, { urls: [`${baseURL}/brand`], name: 'GitHub UI project' });
    await page.goto(`/app/projects/${projectId}/settings`);
    return projectId;
}

async function authorize(page: Page) {
    await page.getByRole('region', { name: 'GitHub', exact: true }).getByRole('link', { name: 'Connect GitHub', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Install the uier test app' })).toBeVisible();
    await page.getByRole('button', { name: 'Install uier test app' }).click();
    await expect(page.getByRole('heading', { name: 'Authorize the uier test app' })).toBeVisible();
    await page.getByRole('button', { name: 'Authorize uier test app' }).click();
    await expect(page).toHaveURL(/\/settings\?github=connected&githubSetup=[A-Za-z0-9_-]{43}#github$/);
    const section = page.getByRole('region', { name: 'GitHub', exact: true });
    await expect(section.getByRole('button', { name: 'Load repositories' })).toBeVisible();
    return section;
}

test('GitHub installation, repository confirmation and project controls work through the browser', async ({ page, baseURL }) => {
    const projectId = await projectSettings(page, baseURL!);
    await setProjectAccess(page, projectId, 'Anyone with the link');
    const existing = await page.request.post(`/api/review/${projectId}/comments`, { headers: { Origin: baseURL!, 'X-Uier-Visitor': randomBytes(32).toString('base64url') },
        data: { text: 'Existing feedback selected by an explicit backfill', authorName: 'Reviewer', path: '/brand', kind: 'feedback', position: { type: 'page' } } });
    expect(existing.status()).toBe(201);
    const section = await authorize(page);
    await section.getByRole('button', { name: 'Load repositories' }).click();
    await section.getByRole('combobox', { name: 'Repository', exact: true }).click();
    await page.getByRole('option', { name: 'acme/repo-2 (public)' }).click();
    await expect(section.getByRole('alert')).toContainText('This repository is public');
    const save = section.getByRole('button', { name: 'Save GitHub repository' });
    await expect(save).toBeDisabled();
    await expectNoAxeViolations(page);
    await section.getByRole('checkbox', { name: 'Allow shared feedback in this public repository' }).check();
    await save.click();
    await expect(section).toContainText('Repository: acme/repo-2 (public).');
    await expect(section.getByRole('button', { name: 'Turn GitHub sync off' })).toBeVisible();
    await expect(section).not.toContainText('Backfill:');
    await expect(section.getByRole('button', { name: 'Load repositories' })).toHaveCount(0);
    const document = await page.content();
    expect(document).not.toMatch(/BEGIN (?:RSA )?PRIVATE KEY|installation-token-|user-token|never-persist-refresh|v1\.k1\./);
    await section.getByRole('button', { name: 'Turn GitHub sync off' }).click();
    await expect(section.getByRole('button', { name: 'Turn GitHub sync on' })).toBeVisible();
    await page.reload();
    await expect(section.getByRole('button', { name: 'Turn GitHub sync on' })).toBeVisible();
    await section.getByRole('button', { name: 'Turn GitHub sync on' }).click();
    await expect(section.getByRole('button', { name: 'Backfill GitHub feedback' })).toBeEnabled();
    await section.getByRole('button', { name: 'Backfill GitHub feedback' }).click();
    await expect(section).toContainText('A backfill of 1 selected threads is queued. Delivery continues in the background.');
    await section.getByRole('button', { name: 'Disconnect GitHub' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toHaveAccessibleName('Disconnect GitHub from this project?');
    await expect(dialog).toContainText('Existing GitHub issues, comments and copies remain.');
    await animationsFinished(dialog);
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Keep connected' }).click();
    await expect(section.getByRole('button', { name: 'Disconnect GitHub' })).toBeVisible();
    await section.getByRole('button', { name: 'Disconnect GitHub' }).click();
    await dialog.getByRole('button', { name: 'Disconnect GitHub', exact: true }).click();
    await expect(section.getByRole('link', { name: 'Connect GitHub', exact: true })).toBeVisible();
    await page.reload();
    await expect(section.getByRole('link', { name: 'Connect GitHub', exact: true })).toBeVisible();
});

test('GitHub callback failures do not echo authorization credentials and signed-out links have a fixed sign-in return', async ({ page, context, baseURL }) => {
    await projectSettings(page, baseURL!);
    const invalid = await page.request.get('/app/github/setup?installation_id=101&state=private-state&setup_action=install');
    expect(invalid.status()).toBe(400);
    expect(await invalid.text()).not.toContain('private-state');
    expect(invalid.headers()['cache-control']).toBe('no-store');
    const callback = await page.request.get('/app/github/callback?code=private-code&state=private-state');
    expect(callback.status()).toBe(400);
    expect(await callback.text()).not.toMatch(/private-code|private-state/);
    await context.clearCookies();
    for (const path of ['/app/github/callback?code=private-code&state=private-state', '/app/github/setup?installation_id=101&state=private-state']) {
        const response = await page.request.get(path, { maxRedirects: 0 });
        expect(response.status()).toBeGreaterThanOrEqual(300);
        expect(response.status()).toBeLessThan(400);
        expect(new URL(response.headers().location!, baseURL).searchParams.get('next')).toBe('/app');
        expect(response.headers().location).not.toMatch(/private-code|private-state/);
    }
});

test('commenters cannot see GitHub credentials or start a connection', async ({ page, browser, baseURL }) => {
    const projectId = await projectSettings(page, baseURL!);
    const email = uniqueEmail('github-commenter');
    await page.goto('/app/users');
    await page.getByRole('button', { name: 'Invite', exact: true }).click();
    const invite = page.getByRole('dialog');
    await invite.getByLabel('Email').fill(email);
    await invite.getByRole('checkbox', { name: 'GitHub UI project', exact: true }).check();
    await invite.getByRole('button', { name: 'Send invitation' }).click();
    const link = await invite.getByRole('link', { name: 'Open the invitation link' }).getAttribute('href');
    expect(link).toBeTruthy();
    const other = await browser.newContext();
    const commenter = await other.newPage();
    try {
        await commenter.goto(new URL(link!, baseURL!).href);
        await commenter.getByRole('button', { name: 'Accept invitation' }).click();
        await commenter.waitForURL(url => url.pathname === '/brand');
        await commenter.goto(`${baseURL}/app/projects/${projectId}/settings`);
        await expect(commenter.getByRole('region', { name: 'GitHub', exact: true })).toHaveCount(0);
        const response = await commenter.request.get(`${baseURL}/app/github/connect?project=${projectId}`, { maxRedirects: 0 });
        expect(response.status()).toBe(404);
        expect(await commenter.content()).not.toMatch(/BEGIN (?:RSA )?PRIVATE KEY|installation-token-|user-token|never-persist-refresh|githubSetup/);
        await expectNoAxeViolations(commenter);
    } finally { await other.close(); }
});
