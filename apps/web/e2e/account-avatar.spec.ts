import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { expectNoAxeViolations } from './accessibility';
import { appNavigation, closeAppNavigation, signIn, uniqueEmail } from './support/app';

// Account → General → Profile: upload, change and remove the profile picture (uier #30)

const photo = async (width: number, height: number) => ({
    name: 'photo.jpg', mimeType: 'image/jpeg',
    buffer: await sharp({ create: { width, height, channels: 3, background: { r: 30, g: 110, b: 190 } } }).jpeg().toBuffer()
});

test('the profile picture is uploaded, shown beside the name, replaced and removed', async ({ page }) => {
    await signIn(page, uniqueEmail('avatar'), { from: '/app/sign-in?next=%2Fapp%2Faccount' });
    await expect(page).toHaveURL(/\/app\/account$/);
    const profile = page.locator('#profile');
    const pictures = profile.getByRole('group', { name: 'Picture' });
    const profilePicture = profile.locator('img');
    /** The account menu at the bottom of the sidebar (a sheet on phones) shows the same picture */
    const expectMenuPicture = async (src: string | null) => {
        await appNavigation(page);
        const picture = page.getByRole('button', { name: /^Account:/ }).locator('img');
        if (src) await expect(picture).toHaveAttribute('src', src);
        else await expect(picture).toHaveCount(0);
        await closeAppNavigation(page);
    };
    await expect(pictures.getByRole('button', { name: 'Remove picture' })).toHaveCount(0);
    await expect(profilePicture).toHaveCount(0);

    // Not an image: the server says why, and nothing changes
    let chooser = page.waitForEvent('filechooser');
    await pictures.getByRole('button', { name: 'Upload picture' }).click();
    await (await chooser).setFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    await expect(profile.getByRole('alert')).toHaveText('Use a PNG, JPEG, WebP or GIF image.');

    chooser = page.waitForEvent('filechooser');
    await pictures.getByRole('button', { name: 'Upload picture' }).click();
    await (await chooser).setFiles(await photo(640, 480));
    await expect(page.getByText('Your picture is saved.')).toBeVisible();
    await expect(profile.getByRole('alert')).toHaveCount(0);
    await expect(profilePicture).toBeVisible();
    const first = await profilePicture.getAttribute('src');
    expect(first).toMatch(/^\/api\/avatars\/u_[A-Za-z0-9_-]+\/[A-Za-z0-9_-]{21}$/);
    expect(await profilePicture.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([256, 256]);
    await expectMenuPicture(first);
    await expectNoAxeViolations(page);

    chooser = page.waitForEvent('filechooser');
    await pictures.getByRole('button', { name: 'Change picture' }).click();
    await (await chooser).setFiles(await photo(120, 300));
    await expect(profilePicture).not.toHaveAttribute('src', first!);
    await expect.poll(() => profilePicture.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([120, 120]);
    // The replaced picture is gone
    expect((await page.request.get(first!)).status()).toBe(404);

    await pictures.getByRole('button', { name: 'Remove picture' }).click();
    await expect(page.getByText('Your picture is removed.')).toBeVisible();
    await expect(profilePicture).toHaveCount(0);
    await expect(pictures.getByRole('button', { name: 'Upload picture' })).toBeVisible();
    await expectMenuPicture(null);
});
