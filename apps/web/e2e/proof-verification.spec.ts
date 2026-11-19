import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { enableProjectVerification, hydrated, setProjectAccess, signIn, uniqueEmail } from './support/app';

async function bitmap(name: string, background: string) {
    return { name, mimeType: 'image/png', buffer: await sharp({ create: { width: 320, height: 200, channels: 3, background } }).png().toBuffer() };
}

async function selectPoint(page: Page, isMobile: boolean, index: number) {
    if (isMobile) {
        await page.locator('[data-proof-surface="image"]').first().tap({ position: { x: 90 + index * 70, y: 70 } });
    } else {
        const preview = page.getByRole('region', { name: 'File preview' });
        await preview.focus();
        for (let step = 0; step <= index; step++) await preview.press('ArrowRight');
        await preview.press('Enter');
    }
}

test('the original guest checks two revised details and retains focus on the next request', async ({ page, browser, isMobile }) => {
    test.setTimeout(120_000);
    await signIn(page, uniqueEmail('proof-verification'));
    const mode = page.getByRole('radio', { name: 'Files only' });
    await hydrated(mode);
    await mode.click();
    await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Price list review');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.waitForURL(/\/projects\/[\w-]{21}\/files$/);
    const files = new URL(page.url()).pathname;
    const project = files.split('/')[3]!;
    await setProjectAccess(page, project, 'Anyone with the link');
    await enableProjectVerification(page, project);
    await page.goto(files);

    await page.getByRole('button', { name: 'Upload file' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Choose file').setInputFiles(await bitmap('Prices.png', '#c0d1ef'));
    await dialog.getByRole('button', { name: 'Upload file' }).click();
    const firstEdition = dialog.getByRole('link', { name: 'Version 1 · Prices.png' });
    await expect(firstEdition).toBeVisible();
    const source = await firstEdition.getAttribute('href');
    await dialog.getByRole('button', { name: 'Create review link' }).click();
    const share = await dialog.getByRole('textbox', { name: 'Review link', exact: true }).inputValue();
    await dialog.getByLabel('New version file').setInputFiles(await bitmap('Prices-2.png', '#c8e7d1'));
    await dialog.getByRole('button', { name: 'Upload version' }).click();
    await expect(dialog.getByRole('link', { name: 'Version 2 · Prices-2.png' })).toBeVisible();

    const guest = await browser.newContext({ viewport: isMobile ? { width: 390, height: 844 } : { width: 1200, height: 850 }, isMobile, hasTouch: isMobile });
    try {
        const review = await guest.newPage();
        await review.goto(share);
        await expect(review.getByRole('img', { name: 'File preview' })).toBeVisible();
        await review.goto(source!);
        const threads: string[] = [];
        for (const [index, text] of ['Correct the lunch price', 'Update the weekend price'].entries()) {
            await review.getByRole('combobox', { name: 'Review tool', exact: true }).click();
            await review.getByRole('option', { name: 'Point pin', exact: true }).click();
            await selectPoint(review, isMobile, index);
            await review.getByLabel('Your name', { exact: true }).fill('Original guest');
            await review.getByRole('textbox', { name: 'Add comment', exact: true }).fill(text);
            await review.getByRole('button', { name: 'Add comment', exact: true }).click();
            await expect(review.getByRole('heading', { name: `Thread #${index + 1}`, exact: true })).toBeVisible();
            threads.push(review.url());
        }

        for (const [index, thread] of threads.entries()) {
            await page.goto(thread);
            await page.getByRole('button', { name: 'Request verification', exact: true }).click();
            const request = page.getByRole('form', { name: 'Request verification', exact: true });
            await request.getByLabel('Fix summary').fill('Updated the price in version 2.');
            await request.getByRole('button', { name: 'Choose location', exact: true }).click();
            await expect(page.getByRole('combobox', { name: 'Version', exact: true })).toContainText('Version 2');
            await selectPoint(page, isMobile, index);
            await expect(request.getByText('Using the selected location.')).toBeVisible();
            await request.getByRole('button', { name: 'Request verification', exact: true }).click();
            await expect(request).toBeHidden();
        }

        await review.goto(share);
        await expect(review.getByText('Changes ready for you to check (2)', { exact: true })).toBeVisible();
        await review.getByRole('button', { name: 'Next pending check', exact: true }).click();
        await expect(review.getByText('Fix check for version 2', { exact: true })).toBeVisible();
        const first = new URL(review.url()).searchParams.get('thread');
        await review.getByRole('button', { name: 'Before', exact: true }).click();
        await expect(review.getByRole('combobox', { name: 'Version', exact: true })).toContainText('Version 1');
        await review.getByRole('button', { name: 'After', exact: true }).click();
        await expect(review.getByRole('combobox', { name: 'Version', exact: true })).toContainText('Version 2');

        const confirm = review.getByRole('button', { name: 'Confirm fix', exact: true });
        if (isMobile) await confirm.tap();
        else { await confirm.focus(); await confirm.press('Enter'); }
        await expect(review.getByText('Changes ready for you to check (1)', { exact: true })).toBeVisible();
        expect(new URL(review.url()).searchParams.get('thread')).not.toBe(first);
        await expect(review.getByRole('heading', { name: /^Thread #/ })).toBeFocused();

        await review.getByRole('button', { name: 'Still needs work', exact: true }).click();
        await expect(review.getByRole('status').filter({ hasText: 'No more changes to check on this version.' })).toBeVisible();
        await expect(review.getByRole('heading', { name: 'Comments', exact: true })).toBeFocused();
    } finally {
        await guest.close();
    }
});
