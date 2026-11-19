import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { expectNoAxeViolations } from './accessibility';
import { appNavigation, closeAppNavigation, hydrated, signIn, uniqueEmail } from './support/app';

const png = async (width: number, height: number) => ({
    name: 'logo.png', mimeType: 'image/png',
    buffer: await sharp({ create: { width, height, channels: 4, background: 'rgba(30, 110, 190, 0.8)' } }).png().toBuffer()
});

test('workspace settings updates the sidebar logo and keeps the default for other workspaces', async ({ page }, testInfo) => {
    const settings = '/app/workspace/settings';
    await signIn(page, uniqueEmail('workspace-logo'));
    await page.goto(settings);
    const section = page.getByRole('region', { name: 'Workspace logo', exact: true });
    const preview = section.locator('img');
    const switcher = page.getByRole('button', { name: /^Workspace:/ });
    const sidebarLogo = switcher.locator('img');
    const upload = section.getByRole('button', { name: /^(Upload|Change) logo$/ });
    const remove = section.getByRole('button', { name: 'Remove logo' });
    async function choose(file: Awaited<ReturnType<typeof png>>) {
        const chooser = page.waitForEvent('filechooser');
        await upload.click();
        await (await chooser).setFiles(file);
    }

    await hydrated(upload);
    await expect(preview).toHaveCount(0);
    await expect(remove).toHaveCount(0);
    await choose({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('<svg/>') });
    await expect(section.getByRole('alert')).toHaveText('Use a PNG, JPEG, WebP or GIF image.');
    await expect(preview).toHaveCount(0);

    await choose(await png(400, 200));
    await expect(preview).toBeVisible();
    await expect(section.getByRole('alert')).toHaveCount(0);
    const first = (await preview.getAttribute('src'))!;
    expect(first).toMatch(/\/api\/workspaces\/w_[A-Za-z0-9_-]+\/logo\/[A-Za-z0-9_-]{21}\?size=32$/);
    await expect(preview).toHaveAttribute('srcset', /size=32 1x, .*size=64 2x/);
    await appNavigation(page);
    await expect(sidebarLogo).toBeVisible();
    await expect(sidebarLogo).toHaveAttribute('src', first);
    await closeAppNavigation(page);
    await expectNoAxeViolations(page);

    await choose(await png(200, 400));
    await expect(preview).not.toHaveAttribute('src', first);
    await expect(preview).toBeVisible();
    const replacement = (await preview.getAttribute('src'))!;
    expect((await page.request.get(first)).status()).toBe(404);
    await page.reload();
    await expect(preview).toHaveAttribute('src', replacement);
    await appNavigation(page);
    await expect(sidebarLogo).toBeVisible();
    await expect(sidebarLogo).toHaveAttribute('src', replacement);

    await switcher.click();
    await page.getByRole('menuitem', { name: 'Create workspace' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create workspace' });
    await dialog.getByLabel('Workspace name').fill('Another workspace');
    await dialog.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page).toHaveURL(/\/app\/projects\/new$/);
    await appNavigation(page);
    await expect(switcher).toContainText('Another workspace');
    await expect(sidebarLogo).toHaveCount(0);
    await expect(switcher.locator('[data-slot="avatar-fallback"] svg')).toBeVisible();
    await switcher.click();
    await page.getByRole('menuitem', { name: /^Personal.*Admin/ }).click();
    await expect(async () => {
        await appNavigation(page);
        await expect(switcher).toContainText('Personal', { timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await page.goto(settings);
    await expect(preview).toHaveAttribute('src', replacement);

    if (testInfo.project.use.isMobile) await remove.click();
    else await remove.press('Enter');
    await expect(upload).toHaveText('Upload logo');
    await expect(preview).toHaveCount(0);
    if (!testInfo.project.use.isMobile) await expect(upload).toBeFocused();
    expect((await page.request.get(replacement)).status()).toBe(404);
    await appNavigation(page);
    await expect(sidebarLogo).toHaveCount(0);
    await expect(switcher.locator('[data-slot="avatar-fallback"] svg')).toBeVisible();
});
