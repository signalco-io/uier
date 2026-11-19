import { expect, test, type Browser, type Page } from '@playwright/test';
import sharp from 'sharp';
import { proofApiPath, type ProofScope, type ProofShare } from '../src/lib/proofs/model';
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

function shareAddress(href: string, fragment: string) {
    const url = new URL(href);
    url.hash = fragment;
    return url.href;
}

async function reopenShareInTab(review: Page, href: string) {
    const url = new URL(href);
    await expect(review).toHaveURL(shareAddress(href, ''));
    // This is the fragment-only navigation the browser makes when pasting the same link again.
    await review.evaluate(hash => { window.location.hash = hash; }, url.hash);
}

async function createGuestProofProject(page: Page, name: string) {
    await signIn(page, uniqueEmail('proof-share'));
    const mode = page.getByRole('radio', { name: 'Files only' });
    await hydrated(mode);
    await mode.click();
    await page.getByRole('textbox', { name: 'Project name', exact: true }).fill(name);
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.waitForURL(/\/projects\/[\w-]{21}\/files$/);
    const files = new URL(page.url()).pathname;
    const project = files.split('/')[3]!;
    await setProjectAccess(page, project, 'Anyone with the link');
    return { files, project };
}

async function publishReview(page: Page) {
    const { files, project } = await createGuestProofProject(page, 'Price list review');
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

    return { share, source: source!, project, dialog };
}

function guestContext(browser: Browser, isMobile: boolean) {
    return browser.newContext({ viewport: isMobile ? { width: 390, height: 844 } : { width: 1200, height: 850 }, isMobile, hasTouch: isMobile });
}

test('the original guest reopens a share in the same tab and checks two revised details', async ({ page, browser, isMobile }) => {
    test.setTimeout(120_000);
    const { share, source, project, dialog } = await publishReview(page);
    const guest = await guestContext(browser, isMobile);
    try {
        const review = await guest.newPage();
        await review.goto(share);
        await expect(review.getByRole('img', { name: 'File preview' })).toBeVisible();
        await review.goto(source);
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

        await review.goto(share);
        await expect(review).toHaveURL(shareAddress(share, ''));
        await expect(review.getByRole('combobox', { name: 'Version', exact: true })).toContainText('Version 1');
        await expect(review.getByText('Changes ready for you to check', { exact: false })).toHaveCount(0);
        await dialog.getByLabel('New version file').setInputFiles(await bitmap('Prices-2.png', '#c8e7d1'));
        await dialog.getByRole('button', { name: 'Upload version' }).click();
        const secondEdition = dialog.getByRole('link', { name: 'Version 2 · Prices-2.png' });
        await expect(secondEdition).toBeVisible();
        const version2 = new URL((await secondEdition.getAttribute('href'))!, share).searchParams.get('version')!;

        let firstRevisedLocation: unknown;
        for (const [index, thread] of threads.entries()) {
            await page.goto(thread);
            await page.getByRole('button', { name: 'Request verification', exact: true }).click();
            const request = page.getByRole('form', { name: 'Request verification', exact: true });
            await request.getByLabel('Fix summary').fill('Updated the price in version 2.');
            await request.getByRole('button', { name: 'Choose location', exact: true }).click();
            await expect(page.getByRole('combobox', { name: 'Version', exact: true })).toContainText('Version 2');
            if (isMobile && index === 1) {
                await expect(page.getByRole('region', { name: 'File preview' }).getByRole('button', { name: 'Thread 1', exact: true })).toBeVisible();
            }
            await selectPoint(page, isMobile, isMobile ? 0 : index);
            await expect(request.getByText('Using the selected location.')).toBeVisible();
            const response = page.waitForResponse(item => item.request().method() === 'POST' && item.url().split('?')[0]!.endsWith('/verification'));
            await request.getByRole('button', { name: 'Request verification', exact: true }).click();
            const saved = await response;
            expect(saved.ok()).toBe(true);
            const body = saved.request().postDataJSON() as { evidence: { after: { anchor: unknown } } };
            const revised = body.evidence.after.anchor;
            if (index === 0) firstRevisedLocation = revised;
            else if (isMobile) expect(revised).toEqual(firstRevisedLocation);
            await expect(request).toBeHidden();
        }

        const assetId = new URL(share).pathname.split('/').at(-1)!;
        const pending = new URL(`${proofApiPath(project)}/assets/${assetId}/verification`, share);
        pending.searchParams.set('version', version2);
        const queued = await review.request.get(pending.href);
        expect(queued.ok()).toBe(true);
        expect(await queued.json()).toMatchObject({ count: 2 });

        await reopenShareInTab(review, share);
        await expect(review.getByRole('combobox', { name: 'Version', exact: true })).toContainText('Version 2');
        await expect(review).toHaveURL(shareAddress(share, ''));
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

        const permalink = threads[0]!;
        await review.goto(permalink);
        await expect(review.getByRole('heading', { name: 'Thread #1', exact: true })).toBeVisible();
        await reopenShareInTab(review, shareAddress(permalink, new URL(share).hash));
        await expect(review).toHaveURL(permalink);
        await expect(review.getByRole('combobox', { name: 'Version', exact: true })).toContainText('Version 1');
        await expect(review.getByRole('heading', { name: 'Thread #1', exact: true })).toBeVisible();
    } finally {
        await guest.close();
    }
});

test('reopening a collection in the same guest tab refreshes its files and replaces the grant', async ({ page, browser, isMobile }) => {
    test.setTimeout(90_000);
    const { files, project } = await createGuestProofProject(page, 'Launch proofs');
    const origin = new URL(page.url()).origin;
    const api = proofApiPath(project);
    const created = await page.request.post(`${api}/collections`, { headers: { origin }, data: { name: 'Launch files' } });
    expect(created.ok()).toBe(true);
    const { collection } = await created.json() as { collection: { id: string } };
    const scope: ProofScope = { kind: 'collection', id: collection.id };
    async function createShare(permission: ProofShare['permission']) {
        const response = await page.request.post(`${api}/shares`, { headers: { origin }, data: { scope, permission } });
        expect(response.ok()).toBe(true);
        const { url } = await response.json() as { url: string };
        return new URL(url, origin).href;
    }
    const commentingLink = await createShare('comment');
    const readOnlyLink = await createShare('view');

    const guest = await browser.newContext({ viewport: isMobile ? { width: 390, height: 844 } : { width: 1200, height: 850 }, isMobile, hasTouch: isMobile });
    try {
        const review = await guest.newPage();
        await review.goto(commentingLink);
        await expect(review).toHaveURL(shareAddress(commentingLink, ''));
        await expect(review.getByText('This collection is empty.', { exact: true })).toBeVisible();

        await page.goto(files);
        await page.getByRole('button', { name: 'Upload file' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('combobox', { name: 'Collection', exact: true }).click();
        await page.getByRole('option', { name: 'Launch files', exact: true }).click();
        await dialog.getByLabel('Choose file').setInputFiles(await bitmap('Press kit.png', '#c0d1ef'));
        await dialog.getByRole('button', { name: 'Upload file', exact: true }).click();
        const edition = dialog.getByRole('link', { name: 'Version 1 · Press kit.png' });
        await expect(edition).toBeVisible();
        const assetId = new URL((await edition.getAttribute('href'))!, origin).pathname.split('/').at(-1)!;
        const detail = `${origin}${api}/assets/${assetId}`;
        const previous = await guest.request.get(detail);
        expect(previous.ok()).toBe(true);
        expect(await previous.json()).toMatchObject({ permissions: { comment: true } });

        await reopenShareInTab(review, readOnlyLink);
        await expect(review.getByRole('link', { name: 'Press kit', exact: true })).toBeVisible();
        await expect(review).toHaveURL(shareAddress(readOnlyLink, ''));
        const current = await guest.request.get(detail);
        expect(current.ok()).toBe(true);
        expect(await current.json()).toMatchObject({ permissions: { comment: false } });
    } finally {
        await guest.close();
    }
});

test('a guest follows a file thread and resumes its fix check in a fresh browser', async ({ page, browser, isMobile }) => {
    test.setTimeout(120_000);
    const { share, source } = await publishReview(page);
    const original = await guestContext(browser, isMobile);
    const secondGuest = await guestContext(browser, isMobile);
    const returning = await guestContext(browser, isMobile);
    try {
        const review = await original.newPage();
        await review.goto(share);
        await expect(review.getByRole('img', { name: 'File preview' })).toBeVisible();
        await review.goto(source);
        await review.getByLabel('Your name', { exact: true }).fill('Original guest');
        await review.getByRole('textbox', { name: 'Add comment', exact: true }).fill('Update the price in the footer');
        await review.getByRole('button', { name: 'Add comment', exact: true }).click();
        await expect(review.getByRole('heading', { name: 'Thread #1', exact: true })).toBeVisible();
        const threadUrl = review.url();
        const mailbox = uniqueEmail('proof-review-guest');
        await review.getByRole('button', { name: 'Follow thread', exact: true }).click();
        const follow = review.getByRole('form', { name: 'Follow thread' });
        await follow.getByRole('textbox', { name: 'Email', exact: true }).fill(mailbox);
        await follow.getByRole('button', { name: 'Send confirmation email' }).click();
        await expect(review.getByText('Check your email to confirm this follow.')).toBeVisible();
        const emailLink = await review.getByRole('link', { name: 'Open local confirmation link' }).getAttribute('href');
        expect(emailLink).toBeTruthy();

        const other = await secondGuest.newPage();
        await other.goto(share);
        await expect(other.getByRole('img', { name: 'File preview' })).toBeVisible();
        await other.goto(threadUrl);
        await expect(other.getByRole('heading', { name: 'Thread #1', exact: true })).toBeVisible();
        await expect(other.getByRole('button', { name: 'Follow thread', exact: true })).toHaveCount(0);
        await expect(other.getByText(mailbox)).toHaveCount(0);

        await page.goto(threadUrl);
        await page.getByRole('button', { name: 'Request verification', exact: true }).click();
        const request = page.getByRole('form', { name: 'Request verification', exact: true });
        await request.getByLabel('Fix summary').fill('The footer price is corrected in version 2.');
        await request.getByRole('button', { name: 'Choose location', exact: true }).click();
        await expect(page.getByRole('combobox', { name: 'Version', exact: true })).toContainText('Version 2');
        await selectPoint(page, isMobile, 0);
        await expect(request.getByText('Using the selected location.')).toBeVisible();
        await request.getByRole('button', { name: 'Request verification', exact: true }).click();
        await expect(request).toBeHidden();

        await other.reload();
        await expect(other.getByText('The footer price is corrected in version 2.')).toBeVisible();
        await expect(other.getByRole('button', { name: 'Confirm fix', exact: true })).toHaveCount(0);

        const fresh = await returning.newPage();
        await fresh.goto(threadUrl);
        await expect(fresh.getByText('This review link is unavailable.', { exact: true })).toBeVisible();
        await fresh.getByRole('button', { name: 'Recover guest review', exact: true }).click();
        const recover = fresh.getByRole('form', { name: 'Recover guest review' });
        await recover.getByRole('textbox', { name: 'Email', exact: true }).fill(uniqueEmail('not-enrolled'));
        await recover.getByRole('button', { name: 'Send recovery link', exact: true }).click();
        await expect(recover.getByRole('status')).toContainText('we’ll send a recovery link');
        expect(await returning.cookies()).toEqual([]);

        await fresh.goto(emailLink!);
        await expect(fresh.getByRole('heading', { name: 'Confirm file thread follow', exact: true })).toBeVisible();
        expect(new URL(fresh.url()).hash).toBe('');
        expect(await returning.cookies()).toEqual([]);
        await fresh.getByRole('button', { name: 'Confirm email and open file', exact: true }).click();
        await expect(fresh.getByRole('heading', { name: 'Thread #1', exact: true })).toBeVisible();
        await expect(fresh.getByText('You’re following this thread.')).toBeVisible();
        await expect(fresh.getByRole('textbox', { name: 'Add comment', exact: true })).toHaveCount(0);
        await fresh.getByRole('button', { name: 'Resume pending checks', exact: true }).click();
        await expect(fresh.getByRole('combobox', { name: 'Version', exact: true })).toContainText('Version 2');
        const confirm = fresh.getByRole('button', { name: 'Confirm fix', exact: true });
        if (isMobile) await confirm.tap();
        else { await confirm.focus(); await confirm.press('Enter'); }
        await expect(fresh.getByRole('status').filter({ hasText: 'No more changes to check on this version.' })).toBeVisible();

        await fresh.goto(threadUrl);
        await fresh.getByRole('button', { name: 'Unfollow thread', exact: true }).click();
        await expect(fresh.getByText('This review link is unavailable.', { exact: true })).toBeVisible();
        await fresh.goto(emailLink!);
        await fresh.getByRole('button', { name: 'Confirm email and open file', exact: true }).click();
        await expect(fresh.getByRole('alert').filter({ hasText: 'This file review link has expired or is unavailable.' })).toBeVisible();

        await review.goto(threadUrl);
        await expect(review.getByRole('button', { name: 'Follow thread', exact: true })).toBeVisible();
    } finally {
        await Promise.all([original.close(), secondGuest.close(), returning.close()]);
    }
});
