import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { appNavigation, createProject, projectPublicId, signIn, uniqueEmail } from './support/app';
import { animationsFinished } from './support/toolbar';

/** Opens another workspace from the menu; it lands on `landing` (a workspace without projects opens on a new one) */
async function switchWorkspace(page: import('@playwright/test').Page, name: RegExp, landing: RegExp) {
    await appNavigation(page);
    await page.getByRole('button', { name: /^Workspace:/ }).click();
    await page.getByRole('menuitem', { name }).click();
    await expect(page).toHaveURL(landing);
}

test('an admin of two workspaces transfers a project from the danger zone', async ({ page }) => {
    await signIn(page, uniqueEmail('transfer-project'));
    const projectId = await createProject(page, { urls: ['moving.example.com'], name: 'Moving site' });
    const publicId = await projectPublicId(page, projectId);
    const danger = page.getByRole('region', { name: 'Danger zone' });
    const open = danger.getByRole('button', { name: 'Transfer project' });

    // With no other workspace to administer there is nowhere to go
    await page.goto(`/app/projects/${projectId}/settings/danger-zone`);
    await expect(danger.getByRole('heading', { level: 3 })).toHaveText(['Mark as done', 'Transfer project', 'Delete project']);
    await expect(danger).toContainText('You are not an admin of another workspace yet.');
    await expect(open).toBeDisabled();

    await appNavigation(page);
    await page.getByRole('button', { name: /^Workspace:/ }).click();
    await page.getByRole('menuitem', { name: 'Create workspace' }).click();
    const create = page.getByRole('dialog', { name: 'Create workspace' });
    await create.getByLabel('Workspace name').fill('Agency');
    await create.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page).toHaveURL(/\/app\/projects\/new$/);
    await switchWorkspace(page, /@example\.com.*Admin/, /\/app\/projects$/);

    await page.goto(`/app/projects/${projectId}/settings/danger-zone`);
    await open.click();
    const dialog = page.getByRole('alertdialog', { name: 'Transfer Moving site?' });
    // The only workspace is chosen, so the name is next
    await expect(dialog.getByRole('combobox', { name: 'Workspace' })).toContainText('Agency');
    await expect(dialog.getByRole('list', { name: 'Stays in this workspace' }).getByRole('listitem'))
        .toHaveText(['Access tokens and connected apps of this workspace lose access to it.']);
    const name = dialog.getByLabel('Type the project name to confirm');
    const confirm = dialog.getByRole('button', { name: 'Transfer project' });
    await expect(name).toBeFocused();
    await expect(confirm).toBeDisabled();
    await animationsFinished(dialog);
    await expectNoAxeViolations(page);

    await name.fill('moving site');
    await expect(confirm).toBeDisabled();
    await name.fill('Moving site');
    await expect(confirm).toBeEnabled();
    await name.press('Enter');

    // The app opens the project in its new workspace, at the same address
    await page.waitForURL(url => url.pathname === `/app/projects/${projectId}`);
    await expect(page.getByText('Moving site is in Agency now.', { exact: true })).toBeVisible();
    await appNavigation(page);
    await expect(page.getByRole('button', { name: /^Workspace:/ })).toContainText('Agency');
    // Review links keep working
    expect(await projectPublicId(page, projectId)).toBe(publicId);

    // The old workspace no longer has it
    await switchWorkspace(page, /@example\.com.*Admin/, /\/app\/projects\/new$/);
    expect((await page.goto(`/app/projects/${projectId}/settings`))?.status()).toBe(404);
});
