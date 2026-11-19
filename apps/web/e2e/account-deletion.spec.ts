import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, signIn, uniqueEmail } from './support/app';
import { RECENT_SIGN_IN_SECONDS } from '../src/lib/app/limits';
import { signToken, verifyToken } from '../src/lib/app/tokens';

/** Waits for the dialog to finish opening before an axe scan: its text is too faint while it fades in */
const settled = (page: Page) => page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));

test('confirming an account deletion ends its sessions and opens a fresh account on the next sign-in', async ({ page, browser, context }) => {
    const email = uniqueEmail('delete-account');
    await signIn(page, email);
    const otherDevice = await browser.newContext({ storageState: await context.storageState() });
    try {
        await page.goto('/app/account');
        const trigger = page.getByRole('region', { name: 'Delete account' }).getByRole('button', { name: 'Delete account', exact: true });
        await trigger.click();
        const dialog = page.getByRole('alertdialog', { name: 'Delete your account?' });
        const field = dialog.getByRole('textbox');
        const confirm = dialog.getByRole('button', { name: 'Delete account' });
        await expect(field).toBeFocused();
        await settled(page);
        await expectNoAxeViolations(page, { include: ['[role="alertdialog"]'] });
        await field.fill(uniqueEmail('wrong'));
        await expect(confirm).toBeDisabled();
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await trigger.click();
        await expect(field).toHaveValue('');
        await field.fill(email);
        await confirm.click();
        await expect(page).toHaveURL(/\/app\/sign-in\?deleted=[\w.-]{40,}$/);
        await expect(page.getByText('Your account has been deleted.')).toBeVisible();
        // The notice is signed: a link someone wrote does not show it
        await page.goto('/app/sign-in?deleted=1');
        await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
        await expect(page.getByText('Your account has been deleted.')).toHaveCount(0);
        const oldSession = await otherDevice.request.get(new URL('/api/account/sessions', page.url()).href);
        expect(await oldSession.json()).toEqual({ userId: null });
        await signIn(page, email, { welcome: 'stay' });
        await expect(page).toHaveURL(/\/app\/welcome/);
    } finally { await otherDevice.close(); }
});

/** The keys of this browser's copies of the app shell (IndexedDB `uier-app`): each names its account */
function shellCopies(page: Page) {
    return page.evaluate(() => new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open('uier-app');
        request.onupgradeneeded = () => request.result.createObjectStore('entries');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const database = request.result;
            const keys = database.transaction('entries').objectStore('entries').getAllKeys();
            keys.onsuccess = () => { database.close(); resolve(keys.result.map(String).filter(key => key.startsWith('shell:'))); };
            keys.onerror = () => reject(keys.error);
        };
    }));
}

test('deleting the active account preserves the other signed-in account on this browser', async ({ page }) => {
    const kept = uniqueEmail('keep-account'), removed = uniqueEmail('remove-account');
    await signIn(page, kept);
    const before = await (await page.request.get('/api/account/sessions')).json();
    await signIn(page, removed, { from: '/app/sign-in?add=1' });
    await page.goto('/app/account');
    // This browser keeps a copy of each signed-in account's sidebar (`shellCache`), under the account's id
    const { userId: removedId } = await (await page.request.get('/api/account/sessions')).json() as { userId: string };
    const copies = async (userId: string) => (await shellCopies(page)).filter(key => key.startsWith(`shell:${encodeURIComponent(userId)}:`)).length;
    await expect.poll(() => copies(removedId)).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Delete account', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('textbox').fill(removed);
    await dialog.getByRole('button', { name: 'Delete account' }).click();
    await expect(page.getByText(`Account deleted. You are now using ${kept}.`)).toBeVisible();
    // The deleted account's copy left the browser with it; the other account has its own
    expect(await copies(removedId)).toBe(0);
    await expect.poll(() => copies(before.userId)).toBeGreaterThan(0);
    await page.goto('/app/account?deleted=1');
    await expect(page.getByRole('region', { name: 'Delete account' })).toBeVisible();
    await expect(page.getByText(/^Account deleted\./)).toHaveCount(0);
    const after = await (await page.request.get('/api/account/sessions')).json();
    expect(after.userId).toBe(before.userId);
    await page.goto('/app/account');
    await expect(page.getByRole('main')).toContainText(kept);
});

test('an older sign-in is offered a fresh one instead of the confirmation, and comes back to Account', async ({ page }) => {
    const email = uniqueEmail('delete-old-sign-in');
    await signIn(page, email);
    await page.goto('/app/account');
    const trigger = page.getByRole('region', { name: 'Delete account' }).getByRole('button', { name: 'Delete account', exact: true });
    const dialog = page.getByRole('alertdialog', { name: 'Delete your account?' });
    const notice = 'To delete your account, sign in again. Deleting it needs a sign-in from the last 10 minutes.';
    // The same session, signed in 11 minutes ago, while the page stays open (local runs sign with the development key)
    process.env.UIER_LOCAL ??= '1';
    const cookie = (await page.context().cookies()).find(cookie => cookie.name === 'uier_session')!;
    const { uid } = verifyToken<{ uid: string }>('session', cookie.value)!;
    const signedInAt = Math.floor(Date.now() / 1000) - RECENT_SIGN_IN_SECONDS - 60;
    await page.context().addCookies([{ ...cookie, value: signToken('session', { uid, iat: signedInAt }, 3600) }]);
    await trigger.click();
    await dialog.getByRole('textbox').fill(email);
    await dialog.getByRole('button', { name: 'Delete account' }).click();
    await expect(dialog).toContainText(notice);
    await expect(dialog.getByRole('textbox')).toHaveCount(0);
    await expect(dialog.getByRole('alert')).toHaveCount(0);

    // A page opened with the old sign-in says so before anything is typed
    await page.reload();
    await trigger.click();
    await expect(dialog).toContainText(notice);
    await expect(dialog.getByRole('button', { name: 'Delete account' })).toHaveCount(0);
    await settled(page);
    await expectNoAxeViolations(page, { include: ['[role="alertdialog"]'] });
    await dialog.getByRole('link', { name: 'Sign in again' }).click();
    await expect(page).toHaveURL(/\/app\/sign-in\?add=1&again=1&next=%2Fapp%2Faccount$/);
    // The card says what this is, and Microsoft is told to ask for the credentials again
    await expect(page.getByRole('heading', { name: 'Sign in again' })).toBeVisible();
    await expect(page.getByText('Sign in to the same account to continue.')).toBeVisible();
    const microsoft = await page.getByRole('link', { name: 'Sign in with Microsoft' }).getAttribute('href');
    const started = await page.request.get(microsoft!, { maxRedirects: 0 });
    expect(new URL(started.headers().location!).searchParams.get('prompt')).toBe('login');
    await signIn(page, email, { from: page.url() });
    await expect(page).toHaveURL(/\/app\/account$/);
    await trigger.click();
    await expect(dialog.getByRole('textbox')).toBeFocused();
});

test('workspaces that need a handoff are named in the dialog, and the account stays', async ({ page }) => {
    const email = uniqueEmail('delete-handoff');
    await signIn(page, email);
    await createProject(page, { urls: ['https://example.com'] });
    await page.goto('/app/account');
    const region = page.getByRole('region', { name: 'Delete account' });
    await region.getByRole('button', { name: 'Delete account', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete your account?' });
    const confirm = dialog.getByRole('button', { name: 'Delete account' });
    await dialog.getByRole('textbox').fill(email);
    await confirm.click();
    const personal = 'Transfer or delete the projects in Personal, or add another admin.';
    await expect(dialog.getByRole('alert')).toHaveText(personal);
    await expect(dialog.getByRole('textbox')).toHaveValue(email);
    await settled(page);
    await expectNoAxeViolations(page, { include: ['[role="alertdialog"]'] });

    // Several workspaces come back in one answer, one per line
    const team = 'Make someone else an admin of Client team before deleting your account.';
    await page.route('**/api/account/sessions', route => route.request().method() === 'POST'
        ? route.fulfill({ status: 400, json: { error: 'invalid_request', message: `${personal}\n${team}` } })
        : route.fallback());
    await confirm.click();
    await expect(dialog.getByRole('alert').getByRole('listitem')).toHaveText([personal, team]);
    await page.unroute('**/api/account/sessions');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.reload();
    await expect(region).toBeVisible();
});
