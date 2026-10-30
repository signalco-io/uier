import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, projectPublicId, signIn, uniqueEmail } from './support/app';

test('an admin deletes a project from the danger zone after typing its name', async ({ page }) => {
    await signIn(page, uniqueEmail('delete-project'));
    const keptId = await createProject(page, { urls: ['kept.example.com'], name: 'Kept site' });
    const projectId = await createProject(page, { urls: ['old.example.com'], name: 'Old site' });
    const publicId = await projectPublicId(page, projectId);
    await page.goto(`/app/projects/${projectId}/settings`);

    const danger = page.getByRole('region', { name: 'Danger zone' });
    await expect(danger.getByRole('heading', { level: 3 })).toHaveText(['Mark as done', 'Delete project']);
    const open = danger.getByRole('button', { name: 'Delete project' });
    await open.click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete Old site?' });
    await expect(dialog).toContainText('Copies already sent to Notion, GitHub, Linear or Slack stay there.');
    const name = dialog.getByLabel('Type the project name to confirm');
    const confirm = dialog.getByRole('button', { name: 'Delete project' });
    await expect(name).toBeFocused();
    await expect(confirm).toBeDisabled();
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    await expectNoAxeViolations(page);

    // Cancel keeps the project and forgets the typed name
    await name.fill('Old site');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
    await open.click();
    await expect(name).toHaveValue('');

    await name.fill('old site');
    await expect(confirm).toBeDisabled();
    await name.press('Enter');
    await expect(dialog).toBeVisible();
    await name.fill('Old site');
    await expect(confirm).toBeEnabled();
    await name.press('Enter');

    await page.waitForURL(url => url.pathname === '/app/projects');
    await expect(page.getByText('Old site was deleted.', { exact: true })).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Old site' })).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('link', { name: 'Kept site' }).first()).toBeVisible();
    expect((await page.goto(`/app/projects/${projectId}/settings`))?.status()).toBe(404);
    // Neither the code nor the public id reaches the review API any more
    for (const code of [projectId, publicId])
        expect((await page.request.get(`/api/review/${code}`)).status()).toBe(404);
    expect((await page.request.get(`/api/review/${keptId}`)).status()).toBe(200);
});
