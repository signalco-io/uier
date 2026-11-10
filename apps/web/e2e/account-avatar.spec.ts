import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { expectNoAxeViolations } from './accessibility';
import { appNavigation, closeAppNavigation, signIn, uniqueEmail } from './support/app';
import { dropFile, pasteFile } from './support/images';

// Account → General → Profile: upload, change and remove the profile picture (uier #30)

const photo = async (width: number, height: number) => ({
    name: 'photo.jpg', mimeType: 'image/jpeg',
    buffer: await sharp({ create: { width, height, channels: 3, background: { r: 30, g: 110, b: 190 } } }).jpeg().toBuffer()
});

test('the profile picture is uploaded, shown beside the name, replaced and removed', async ({ page }, testInfo) => {
    await signIn(page, uniqueEmail('avatar'), { from: '/app/sign-in?next=%2Fapp%2Faccount' });
    await expect(page).toHaveURL(/\/app\/account$/);
    const profile = page.locator('#profile');
    // The avatar left of the name is the button; its menu uploads and removes (uier #205)
    const avatarButton = profile.getByRole('button', { name: 'Edit profile picture' });
    const profilePicture = profile.locator('img');
    const menuItem = async (name: string) => {
        await avatarButton.click();
        const item = page.getByRole('menuitem', { name });
        await expect(item).toBeVisible();
        return item;
    };
    /** The account menu at the bottom of the sidebar (a sheet on phones) shows the same picture */
    const expectMenuPicture = async (src: string | null) => {
        await appNavigation(page);
        const picture = page.getByRole('button', { name: /^Account:/ }).locator('img');
        if (src) await expect(picture).toHaveAttribute('src', src);
        else await expect(picture).toHaveCount(0);
        await closeAppNavigation(page);
    };
    await expect(profilePicture).toHaveCount(0);
    // Left of the name field, with the edit badge, keyboard reachable and described by the file types
    const [avatarBox, nameBox] = await Promise.all([avatarButton.boundingBox(), profile.getByLabel('Name').boundingBox()]);
    expect(avatarBox!.x + avatarBox!.width).toBeLessThanOrEqual(nameBox!.x);
    await expect(avatarButton.locator('[data-edit-badge]')).toBeVisible();
    await expect(avatarButton).toHaveAccessibleDescription(/PNG, JPEG, WebP or GIF, cropped to a square/);
    await avatarButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Upload picture' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Remove picture' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    // Not an image: the server says why, and nothing changes
    let item = await menuItem('Upload picture');
    let chooser = page.waitForEvent('filechooser');
    await item.click();
    await (await chooser).setFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    await expect(profile.getByRole('alert')).toHaveText('Use a PNG, JPEG, WebP or GIF image.');

    item = await menuItem('Upload picture');
    chooser = page.waitForEvent('filechooser');
    await item.click();
    await (await chooser).setFiles(await photo(640, 480));
    await expect(page.getByText('Your picture is saved.')).toBeVisible();
    await expect(profile.getByRole('alert')).toHaveCount(0);
    await expect(profilePicture).toBeVisible();
    const first = await profilePicture.getAttribute('src');
    expect(first).toMatch(/^\/api\/avatars\/u_[A-Za-z0-9_-]+\/[A-Za-z0-9_-]{21}$/);
    expect(await profilePicture.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([256, 256]);
    await expectMenuPicture(first);
    await expectNoAxeViolations(page);

    item = await menuItem('Upload a new picture');
    chooser = page.waitForEvent('filechooser');
    await item.click();
    await (await chooser).setFiles(await photo(120, 300));
    await expect(profilePicture).not.toHaveAttribute('src', first!);
    await expect.poll(() => profilePicture.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([120, 120]);
    // The replaced picture is gone
    expect((await page.request.get(first!)).status()).toBe(404);

    // An image dropped on the avatar, or pasted while it has focus, saves the same way (uier #242)
    let previous = await profilePicture.getAttribute('src');
    await avatarButton.dispatchEvent('dragenter', { dataTransfer: await page.evaluateHandle(() => {
        const data = new DataTransfer();
        data.items.add(new File(['x'], 'drag.png', { type: 'image/png' }));
        return data;
    }) });
    await expect(avatarButton).toHaveAttribute('data-drop-target');
    await dropFile(avatarButton, await photo(200, 300));
    await expect(avatarButton).not.toHaveAttribute('data-drop-target');
    await expect(profilePicture).not.toHaveAttribute('src', previous!);
    await expect.poll(() => profilePicture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(200);
    // A dropped file that is not an image gets the server's answer without being sent
    await dropFile(avatarButton, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') });
    await expect(profile.getByRole('alert')).toHaveText('Use a PNG, JPEG, WebP or GIF image.');
    previous = await profilePicture.getAttribute('src');
    await avatarButton.focus();
    await pasteFile(page, await photo(90, 150));
    await expect(profilePicture).not.toHaveAttribute('src', previous!);
    await expect.poll(() => profilePicture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(90);
    await expect(profile.getByRole('alert')).toHaveCount(0);
    // Pasting into the name field leaves the picture alone
    previous = await profilePicture.getAttribute('src');
    await profile.getByLabel('Name').focus();
    await pasteFile(page, await photo(60, 60));
    await expect(avatarButton).not.toHaveAttribute('aria-busy');
    await expect(profilePicture).toHaveAttribute('src', previous!);

    // Removing with the keyboard (a tap on a phone) gives the focus back to the avatar, when it fails and when it works
    const keyboard = testInfo.project.use.isMobile !== true;
    const removePicture = async () => {
        if (!keyboard) return (await menuItem('Remove picture')).click();
        await avatarButton.focus();
        await page.keyboard.press('Enter');
        // The menu puts the focus on its first item once open; then down to Remove picture
        await expect(page.getByRole('menuitem', { name: 'Upload a new picture' })).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(page.getByRole('menuitem', { name: 'Remove picture' })).toBeFocused();
        await page.keyboard.press('Enter');
    };
    await page.route('**/api/account/avatar', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }), { times: 1 });
    await removePicture();
    await expect(profile.getByRole('alert')).toHaveText('Your picture could not be saved. Try again.');
    if (keyboard) await expect(avatarButton).toBeFocused();
    await expect(profilePicture).toBeVisible();
    await removePicture();
    await expect(page.getByText('Your picture is removed.')).toBeVisible();
    await expect(profilePicture).toHaveCount(0);
    if (keyboard) await expect(avatarButton).toBeFocused();
    await expectMenuPicture(null);
});
