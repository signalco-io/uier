import { expect, test, type Page } from '@playwright/test';
import { appNavigation, closeAppNavigation, createProject, requestSignInEmail, signIn, uniqueEmail } from './support/app';
import { animationsFinished, toolbar } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';
import { startReviewedSite } from './support/reviewedSite';
import { createHash, randomBytes } from 'node:crypto';

async function accountMenu(page: Page) {
    await appNavigation(page);
    await page.getByRole('button', { name: /^Account: / }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await animationsFinished(menu);
    return menu;
}
async function selectAccount(page: Page, email: string) {
    const menu = await accountMenu(page);
    const navigated = page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() });
    await menu.getByRole('menuitem', { name: new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }).click();
    await navigated;
    await page.waitForURL(url => url.pathname !== '/app' && !url.pathname.startsWith('/app/sign-in'));
}

test('the sidebar adds, switches and signs out accounts with a fresh app document and isolated API access', async ({ page, context }) => {
    const a = uniqueEmail('switch-a');
    const b = uniqueEmail('switch-b');
    await signIn(page, a);
    const project = await createProject(page, { urls: ['https://example.com'], name: 'A private project' });
    const tokenA = (await context.cookies()).find(cookie => cookie.name === 'uier_session')!.value;
    const otherTab = await context.newPage();
    await otherTab.goto('/app/account');
    await (await accountMenu(page)).getByRole('menuitem', { name: 'Add account', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Add account', exact: true })).toBeVisible();
    expect((await context.cookies()).find(cookie => cookie.name === 'uier_session')!.value).toBe(tokenA);
    await signIn(page, b, { from: page.url() });
    await page.goto('/app/account');
    await expect(page.getByRole('main')).toContainText(b);
    expect((await context.request.get(`/api/realtime/ticket?projectId=${project}`)).status()).toBe(404);
    // Focusing an existing app tab reconciles an account added in another document.
    await otherTab.bringToFront();
    await otherTab.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(otherTab).toHaveURL(/\/app\/projects\/new$/);
    await appNavigation(otherTab);
    await expect(otherTab.getByRole('button', { name: `Account: ${b.split('@')[0]}`, exact: true })).toBeVisible();
    await closeAppNavigation(otherTab);
    await page.bringToFront();
    const menu = await accountMenu(page);
    await expect(menu).toContainText(a);
    await expect(menu).toContainText(b);
    await expect(menu.getByRole('menuitem', { name: / active$/ })).toBeDisabled();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await closeAppNavigation(page);
    await selectAccount(page, a);
    await page.goto('/app/account');
    await expect(page.getByRole('main')).toContainText(a);
    expect((await context.cookies()).find(cookie => cookie.name === 'uier_session')!.value).toBe(tokenA);
    expect((await context.request.get(`/api/realtime/ticket?projectId=${project}`)).status()).toBe(200);
    await (await accountMenu(page)).getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/projects\/new$/);
    await page.goto('/app/account');
    await expect(page.getByRole('main')).toContainText(b);
    expect((await context.request.get(`/api/realtime/ticket?projectId=${project}`)).status()).toBe(404);
    const remaining = await accountMenu(page);
    await expect(remaining).not.toContainText(a);
    await remaining.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/sign-in$/);
    expect((await context.request.get('/api/account/sessions')).status()).toBe(200);
    expect(await (await context.request.get('/api/account/sessions')).json()).toEqual({ userId: null });
    await otherTab.close();
});

for (const provider of ['Google', 'Microsoft'] as const) {
    test(`Add account supports ${provider} including its email confirmation without signing out the original`, async ({ page, context }) => {
        const first = uniqueEmail(`first-${provider.toLowerCase()}`);
        const second = uniqueEmail(`second-${provider.toLowerCase()}`);
        await signIn(page, first);
        await (await accountMenu(page)).getByRole('menuitem', { name: 'Add account', exact: true }).click();
        await page.getByRole('link', { name: `Sign in with ${provider}` }).click();
        await expect(page.getByRole('heading', { name: `Choose a ${provider} test account` })).toBeVisible();
        await page.getByLabel('Email', { exact: true }).fill(second);
        await page.getByRole('button', { name: 'Allow' }).click();
        await page.waitForURL(url => url.pathname === `/app/sign-in/${provider.toLowerCase()}/link`);
        await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
        await page.getByLabel('Sign-in code', { exact: true }).fill((await page.locator('[data-sign-in-code]').textContent())!);
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await page.waitForURL(url => url.pathname !== '/app' && !url.pathname.startsWith('/app/sign-in'));
        await page.goto('/app/account/sign-in');
        await expect(page.getByRole('main')).toContainText(second);
        const menu = await accountMenu(page);
        await expect(menu).toContainText(first);
        await expect(menu).toContainText(second);
        await menu.getByRole('menuitem', { name: 'Sign out of all accounts', exact: true }).click();
        await expect(page).toHaveURL(/\/app\/sign-in$/);
        expect((await context.cookies()).some(cookie => /^uier_(session|account_\d)$/.test(cookie.name))).toBe(false);
    });
}

test('the account menu shows three accounts and keeps the rest and Add account in a submenu', async ({ page }) => {
    const emails = ['a', 'b', 'c', 'd'].map(key => uniqueEmail(`menu-${key}`));
    await signIn(page, emails[0]!);
    for (const email of emails.slice(1))
        await signIn(page, email, { from: '/app/sign-in?add=1' });
    const menu = await accountMenu(page);
    const accountItems = menu.getByRole('menuitem', { name: /@/ });
    await expect(accountItems).toHaveCount(3);
    await expect(menu.getByRole('menuitem', { name: / active$/ })).toBeDisabled();
    await expect(menu.getByRole('menuitem', { name: 'Add account', exact: true })).toHaveCount(0);
    await menu.getByRole('menuitem', { name: '1 more account', exact: true }).click();
    const more = page.getByRole('menu').last();
    await expect(more.getByRole('menuitem', { name: /@/ })).toHaveCount(1);
    await expect(more.getByRole('menuitem', { name: 'Add account', exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
});

test('Add account cancellation and a failed sign-in leave the original account signed in', async ({ page, context }) => {
    const email = uniqueEmail('cancel-add');
    await signIn(page, email);
    const original = (await context.cookies()).find(cookie => cookie.name === 'uier_session')!.value;
    await page.goto('/app/sign-in?add=1');
    await page.getByRole('link', { name: 'Sign in with Google' }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Google sign-in was cancelled.');
    expect((await context.cookies()).find(cookie => cookie.name === 'uier_session')!.value).toBe(original);
    await requestSignInEmail(page, uniqueEmail('bad-code'));
    await page.getByLabel('Sign-in code', { exact: true }).fill('00000000');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
    expect((await context.cookies()).find(cookie => cookie.name === 'uier_session')!.value).toBe(original);
    await page.goto('/app/account');
    await expect(page.getByRole('main')).toContainText(email);
});

test('coding-tool and extension consent reload their own URL when the active account changes', async ({ page, context, baseURL }) => {
    const a = uniqueEmail('consent-page-a');
    const b = uniqueEmail('consent-page-b');
    await signIn(page, a);
    const { userId: userA } = await (await context.request.get('/api/account/sessions')).json();
    await signIn(page, b, { from: '/app/sign-in?add=1' });
    const { userId: userB } = await (await context.request.get('/api/account/sessions')).json();
    const select = async (userId: string) => {
        expect((await context.request.post('/api/account/sessions', {
            headers: { Origin: baseURL!, 'Sec-Fetch-Site': 'same-origin' }, data: { action: 'switch', userId }
        })).status()).toBe(200);
    };
    await select(userA);
    const clientId = 'abcdefghijklmnopabcdefghijklmnop';
    const challenge = createHash('sha256').update(randomBytes(32)).digest('base64url');
    const registration = await context.request.post('/api/oauth/register', { data: {
        client_name: 'Account reload test', redirect_uris: ['http://127.0.0.1/callback']
    } });
    const oauthClient = await registration.json();
    const authorization = await context.request.get(`/api/oauth/authorize?${new URLSearchParams({
        response_type: 'code', client_id: oauthClient.client_id, redirect_uri: 'http://127.0.0.1/callback',
        code_challenge: challenge, code_challenge_method: 'S256', resource: `${baseURL}/api/mcp`, scope: 'feedback:read'
    })}`, { maxRedirects: 0 });
    const consent = await context.newPage();
    const extension = await context.newPage();
    try {
        await consent.goto(authorization.headers().location!);
        await expect(consent.getByText(`Signed in as ${a}.`)).toBeVisible();
        const consentUrl = consent.url();
        await extension.goto(`/app/extension?${new URLSearchParams({ clientId,
            redirectUri: `https://${clientId}.chromiumapp.org/uier`, challenge, state: randomBytes(32).toString('base64url') })}`);
        // #722 (c45a996a) also lists every account; assert the identity offered for approval.
        await expect(extension.getByText(`Continue as ${a.split('@')[0]}. The extension can review configured sites in projects you can access.`, { exact: true })).toBeVisible();
        const extensionUrl = extension.url();
        await select(userB);
        for (const tab of [consent, extension]) {
            // Send one foreground signal atomically: bringToFront can already start the reload
            // before a following evaluate reaches the previous document.
            await tab.evaluate(() => {
                Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
                window.dispatchEvent(new Event('focus'));
            });
        }
        await expect(consent.getByText(`Signed in as ${b}.`)).toBeVisible();
        await expect(extension.getByText(`Continue as ${b.split('@')[0]}. The extension can review configured sites in projects you can access.`, { exact: true })).toBeVisible();
        expect(consent.url()).toBe(consentUrl);
        expect(extension.url()).toBe(extensionUrl);
        await extension.route(`https://${clientId}.chromiumapp.org/uier**`, route => route.fulfill({ body: 'Extension signed in' }));
        await extension.getByRole('button', { name: 'Sign in to uier', exact: true }).click();
        await extension.waitForURL(url => url.hostname === `${clientId}.chromiumapp.org` && url.searchParams.has('code'));
    } finally {
        await consent.close();
        await extension.close();
    }
});

test('toolbar foreground sign-in follows the active account and clears a removed browser identity', async ({ page, context, baseURL }) => {
    const site = await startReviewedSite(baseURL!);
    try {
        const email = uniqueEmail('toolbar-account');
        await signIn(page, email);
        const project = await createProject(page, { urls: [site.origin()] });
        const review = await context.newPage();
        await review.goto(`${site.origin()}/${project}/pricing?toolbar-code=${project}`);
        await expect(review.getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
        await signIn(page, uniqueEmail('other-toolbar-account'), { from: '/app/sign-in?add=1' });
        await review.bringToFront();
        await review.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
        await expect(toolbar(review)).toContainText('Sign in to see and leave comments.');
        await page.bringToFront();
        await selectAccount(page, email);
        await review.bringToFront();
        await review.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
        await expect(review.getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
        await page.bringToFront();
        await (await accountMenu(page)).getByRole('menuitem', { name: 'Sign out of all accounts', exact: true }).click();
        await expect(page).toHaveURL(/\/app\/sign-in$/);
        await review.bringToFront();
        await review.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
        await expect(toolbar(review)).toContainText('Sign in to see and leave comments.');
        await review.close();
    } finally { await site.close(); }
});


test('a private project link offers a signed-in account and continues with its original query', async ({ page }) => {
    const owner = uniqueEmail('link-switch-owner');
    await signIn(page, owner);
    const project = await createProject(page, { urls: ['https://example.com'], name: 'Linked project' });
    await signIn(page, uniqueEmail('link-switch-other'), { from: '/app/sign-in?add=1' });
    const next = `/app/projects/${project}?view=board&from=shared-link`;
    await page.goto(next);
    await expect(page.getByRole('heading', { name: 'Switch account or workspace' })).toBeVisible();
    // One row per account: its picture or initial, name and whole email; the workspace is named once (uier #390)
    await expect(page.getByRole('main')).toContainText('Choose an account to open this link in the Personal workspace.');
    const choices = page.getByRole('list', { name: 'Accounts that can open this link' }).getByRole('listitem');
    await expect(choices).toHaveCount(1);
    const choice = choices.getByRole('button');
    await expect(choice).toHaveAccessibleName(`${owner.split('@')[0]} ${owner}`);
    await expect(choice.locator('[data-slot="avatar"]')).toHaveText(owner[0]!.toUpperCase());
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expectNoAxeViolations(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveClass(/dark/);
    await animationsFinished(page.locator('main'));
    await expectNoAxeViolations(page);
    await choice.click();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${project}\\?view=board&from=shared-link$`));
    await expect(page.getByRole('heading', { name: 'Linked project', exact: true })).toBeVisible();
});
