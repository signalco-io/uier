import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { signIn, uniqueEmail } from './support/app';
import { signToken, verifyToken } from '../src/lib/app/tokens';
import { PASSKEY_RECENT_SIGN_IN_SECONDS } from '../src/lib/app/passkeys';

// Passkeys with Chromium's virtual authenticator. WebAuthn needs a domain as its RP ID, so these
// pages are opened on localhost, not on the suite's 127.0.0.1 base URL.
const base = `http://localhost:${process.env.PORT || 4004}`;

type VirtualCredential = { credentialId: string; isResidentCredential: boolean; rpId: string; privateKey: string; userHandle: string; signCount: number };

/** A platform authenticator with user verification that answers every prompt by itself */
async function virtualAuthenticator(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true }
    });
    const credentials = async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials as VirtualCredential[];
    return { cdp, authenticatorId, credentials };
}

async function signOut(page: Page) {
    await page.goto(`${base}/app/account`);
    await page.getByRole('region', { name: 'Sign out' }).getByRole('button', { name: 'Sign out' }).click();
}

/** The virtual authenticator answers the email field's autofill at once; this browser has none. */
async function withoutPasskeyAutofill(page: Page) {
    await page.addInitScript(() => {
        PublicKeyCredential.isConditionalMediationAvailable = async () => false;
    });
}

async function addPasskey(page: Page) {
    await page.goto(`${base}/app/account`);
    const section = page.getByRole('region', { name: 'Passkeys' });
    await expect(section).toContainText('No passkeys yet.');
    await section.getByRole('button', { name: 'Add a passkey' }).click();
    await expect(section.getByRole('status')).toHaveText('Passkey added. Use it the next time you sign in.');
    return section;
}

test('a passkey added on Account signs in, and stops working once removed', { tag: '@smoke' }, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Chromium virtual authenticator');
    const authenticator = await virtualAuthenticator(page);
    await withoutPasskeyAutofill(page);
    await signIn(page, uniqueEmail('passkey'), { from: `${base}/app/sign-in` });

    // Both WebAuthn features keep their default `self` allowlist under the app's page policy.
    const policy = (await page.request.get(`${base}/app/account`)).headers()['permissions-policy'];
    expect(policy).toContain('camera=()');
    expect(policy).not.toContain('publickey-credentials');
    const section = await addPasskey(page);
    const passkeys = section.getByRole('list', { name: 'Your passkeys' });
    await expect(passkeys.getByRole('listitem')).toHaveCount(1);
    await expect(passkeys).toContainText('Not used yet');
    const [credential] = await authenticator.credentials();
    expect(credential).toMatchObject({ isResidentCredential: true, rpId: 'localhost' });

    await signOut(page);
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await page.waitForURL(url => url.pathname !== '/app' && !url.pathname.startsWith('/app/sign-in'));
    await page.goto(`${base}/app/account`);
    await expect(passkeys).toContainText('Last used');

    await passkeys.getByRole('button', { name: 'Remove Passkey' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
    await expect(section).toContainText('No passkeys yet.');

    // The browser may forget the credential when told uier no longer knows it; put it back, so
    // the server's answer is what this checks.
    if (!(await authenticator.credentials()).length)
        await authenticator.cdp.send('WebAuthn.addCredential', { authenticatorId: authenticator.authenticatorId, credential: credential! });
    await signOut(page);
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('uier doesn’t know this passkey. It may have been removed. Sign in with your email instead.');
    await expect(page).toHaveURL(`${base}/app/sign-in`);
});

test('passkeys can be renamed, and the email field offers them as autofill', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Chromium virtual authenticator');
    await virtualAuthenticator(page);
    await signIn(page, uniqueEmail('passkey-name'), { from: `${base}/app/sign-in` });
    const section = await addPasskey(page);

    await section.getByRole('button', { name: 'Rename Passkey' }).click();
    const dialog = page.getByRole('dialog', { name: 'Rename passkey' });
    await dialog.getByLabel('Passkey name').fill(' ');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Enter a name for the passkey.');
    await dialog.getByLabel('Passkey name').fill('Work laptop');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(section.getByRole('listitem')).toContainText('Work laptop');
    await expectNoAxeViolations(page);

    // Signed out, the email field (autocomplete="email webauthn") offers the passkey; the virtual
    // authenticator picks it as a person would, which signs in without a click.
    await signOut(page);
    await page.waitForURL(url => url.pathname !== '/app/account');
    await page.waitForURL(url => url.pathname !== '/app' && !url.pathname.startsWith('/app/sign-in'));
    await page.goto(`${base}/app/account`);
    await expect(section.getByRole('listitem')).toContainText('Last used');
});

test('adding a passkey needs a recent sign-in, and Sign in again comes back to Account', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Chromium virtual authenticator');
    await virtualAuthenticator(page);
    const email = uniqueEmail('passkey-old');
    await signIn(page, email, { from: `${base}/app/sign-in` });
    // The same session, signed in 11 minutes ago (local runs sign with the development key)
    process.env.UIER_LOCAL ??= '1';
    const cookies = await page.context().cookies(base);
    const session = cookies.find(cookie => cookie.name === 'uier_session')!;
    const { uid } = verifyToken<{ uid: string }>('session', session.value)!;
    const signedInAt = Math.floor(Date.now() / 1000) - PASSKEY_RECENT_SIGN_IN_SECONDS - 60;
    await page.context().addCookies([{ ...session, value: signToken('session', { uid, iat: signedInAt }, 3600) }]);

    await page.goto(`${base}/app/account`);
    const section = page.getByRole('region', { name: 'Passkeys' });
    await expect(section).toContainText('To add a passkey, sign in again. Adding one needs a sign-in from the last 10 minutes.');
    await expect(section.getByRole('button', { name: 'Add a passkey' })).toHaveCount(0);
    await section.getByRole('button', { name: 'Sign in again' }).click();
    await expect(page).toHaveURL(`${base}/app/sign-in?next=%2Fapp%2Faccount`);
    await signIn(page, email, { from: page.url() });
    await expect(page).toHaveURL(`${base}/app/account`);
    await expect(section.getByRole('button', { name: 'Add a passkey' })).toBeVisible();
});

test('browsers without WebAuthn get no passkey button, and Account says why', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(window, 'PublicKeyCredential', { value: undefined, configurable: true });
    });
    await page.goto(`${base}/app/sign-in`);
    await expect(page.getByRole('button', { name: 'Email me a sign-in code' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toHaveCount(0);
    await signIn(page, uniqueEmail('no-webauthn'), { from: page.url() });
    await page.goto(`${base}/app/account`);
    const section = page.getByRole('region', { name: 'Passkeys' });
    await expect(section).toContainText('This browser does not support passkeys. You can still sign in with an email code.');
    await expect(section.getByRole('button', { name: 'Add a passkey' })).toHaveCount(0);
});
