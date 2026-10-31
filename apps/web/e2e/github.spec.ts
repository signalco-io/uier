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

test('a second project can authorize an existing installation without reopening installation setup', async ({ page, baseURL }) => {
    await projectSettings(page, baseURL!);
    const first = await authorize(page);
    await first.getByRole('button', { name: 'Load repositories' }).click();
    await first.getByRole('combobox', { name: 'Repository', exact: true }).click();
    await page.getByRole('option', { name: 'acme/repo-1 (private)' }).click();
    await first.getByRole('button', { name: 'Save GitHub repository' }).click();
    await expect(first).toContainText('Sync on');
    const secondId = await createProject(page, { urls: [`${baseURL}/brand`], name: 'Second GitHub project' });
    await page.goto(`/app/projects/${secondId}/settings`);
    const second = page.getByRole('region', { name: 'GitHub', exact: true });
    await second.getByRole('link', { name: 'Use acme installation' }).click();
    await expect(page.getByRole('heading', { name: 'Authorize the uier test app' })).toBeVisible();
    await page.getByRole('button', { name: 'Authorize uier test app' }).click();
    await expect(second.getByRole('button', { name: 'Load repositories' })).toBeVisible();
    await expect(second).toContainText('Choose a repository');
    await expect(second.getByRole('button', { name: 'Turn GitHub sync off' })).toHaveCount(0);
    await expectNoAxeViolations(page);
});

test('organization approval returns to the original workspace and explains how to finish connecting', async ({ page, context, baseURL }) => {
    const projectId = await projectSettings(page, baseURL!);
    await page.getByRole('region', { name: 'GitHub', exact: true }).getByRole('link', { name: 'Connect GitHub', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Install the uier test app' })).toBeVisible();
    // Another tab can select a different workspace while GitHub setup is open.
    await context.addCookies([{ name: 'uier_workspace', value: 'w_uier_public', url: baseURL! }]);
    await page.getByRole('button', { name: 'Request organization approval' }).click();
    await expect(page).toHaveURL(`${baseURL}/app/projects/${projectId}/settings?github=pending#github`);
    const section = page.getByRole('region', { name: 'GitHub', exact: true });
    await expect(section).toContainText('Approval needed');
    await expect(section.getByRole('status')).toContainText('Waiting for GitHub approval');
    await expect(section.getByRole('status')).toContainText('An organization owner needs to approve');
    await expect(section.getByRole('link', { name: 'Connect GitHub', exact: true })).toBeVisible();
    await expect(section.getByRole('button', { name: 'Load repositories' })).toHaveCount(0);
    await expect(section.getByRole('button', { name: 'Turn GitHub sync off' })).toHaveCount(0);
    await expectNoAxeViolations(page);
    await section.getByRole('link', { name: 'Connect GitHub', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Install the uier test app' })).toBeVisible();
});

test('GitHub callback failures show in-app recovery without echoing credentials and signed-out links have a fixed return', async ({ page, context, baseURL }) => {
    await projectSettings(page, baseURL!);
    for (const path of ['/app/github/setup?installation_id=101&state=private-state&setup_action=install',
        '/app/github/setup?setup_action=request&state=' + 'x'.repeat(43), '/app/github/setup',
        '/app/github/callback?code=private-code&state=private-state']) {
        const invalid = await page.request.get(path, { maxRedirects: 0 });
        expect(invalid.status()).toBe(302);
        expect(invalid.headers().location).toBe(`${baseURL}/app/github/error`);
        expect(await invalid.text()).not.toMatch(/private-code|private-state/);
        expect(invalid.headers()['cache-control']).toBe('no-store');
    }
    await page.goto('/app/github/setup?setup_action=request&state=private-state');
    await expect(page).toHaveURL(`${baseURL}/app/github/error`);
    await expect(page.getByRole('heading', { name: 'GitHub connection not completed' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Start a new connection' })).toContainText('expired or already been used');
    await expect(page.getByRole('region', { name: 'Start a new connection' }).getByRole('alert')).toContainText('an organization owner needs to approve');
    await expect(page.getByRole('link', { name: 'GitHub setup guide', exact: true })).toHaveAttribute('href', '/integrations/github');
    expect(await page.content()).not.toMatch(/private-state|private-code/);
    await expectNoAxeViolations(page);
    await page.getByRole('link', { name: 'Go to projects', exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}/app/projects`);
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
