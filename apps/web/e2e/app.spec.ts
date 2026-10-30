import { seedEmailBounce } from './support/emailReports';
import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { projectPublicId, appNavigation, closeAppNavigation, createProject, openProjectInvite, requestSignInEmail, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { pngImage } from './support/images';
import { animationsFinished, newVisitor, showcaseHint, toolbar } from './support/toolbar';

// The signed-in app (issue #34): sign-in, onboarding, the sidebar, projects, project settings and the account.

test('signed-out visitors are sent to sign in and come back afterwards', { tag: '@smoke' }, async ({ page }) => {
    await page.goto('/app/account');
    await expect(page).toHaveURL(/\/app\/sign-in\?next=%2Fapp%2Faccount$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expect(page).toHaveTitle('Sign in · uier');
    await expectNoAxeViolations(page);

    await signIn(page, uniqueEmail(), { from: page.url() });
    await expect(page).toHaveURL(/\/app\/account$/);
});

test('a sign-in link works once', { tag: '@smoke' }, async ({ page, browser }) => {
    const email = uniqueEmail();
    await page.goto('/app/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
    const link = await page.getByRole('link', { name: 'Open the sign-in link' }).getAttribute('href');
    expect(link).toMatch(/^\/app\/sign-in\/confirm\?token=/);

    // Opening the link (as an email scanner does) does not use it up
    await page.goto(link!);
    await page.goto(link!);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/app\/projects\/new$/);

    // A second browser can't use it again
    const other = await browser.newPage();
    await other.goto(link!);
    await expect(other.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
    await other.close();
});

const codeError = 'This code did not work. Ask for a new email and try again in this browser.';

async function submitCode(page: import('@playwright/test').Page, code: string) {
    await page.getByLabel('Sign-in code', { exact: true }).fill(code);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('a code signs in the requesting browser, preserves next, and consumes the link', async ({ page, browser }, testInfo) => {
    await page.goto('/app/sign-in?next=%2Fapp%2Faccount');
    const { code, link } = await requestSignInEmail(page, uniqueEmail());
    await expect(page.getByText('Enter the 8-digit code. It works only in this browser.')).toBeVisible();
    const input = page.getByLabel('Sign-in code', { exact: true });
    await expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(input).toHaveAttribute('inputmode', 'numeric');
    const binding = (await page.context().cookies()).find(cookie => cookie.name === 'uier_sign_in_request');
    expect(binding).toMatchObject({ httpOnly: true, sameSite: 'Lax', secure: false, path: '/' });
    expect(binding!.expires - Date.now() / 1000).toBeGreaterThan(850);
    expect(binding!.value).not.toContain(code);
    expect(page.url()).not.toContain(code);
    expect(link).not.toContain(code);
    expect(await page.evaluate(() => document.cookie)).not.toContain('uier_sign_in_request');
    await expectNoAxeViolations(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    await expectNoAxeViolations(page);
    await page.emulateMedia({ colorScheme: 'light' });

    // Inserting a whole code is the same input event as pasting, including leading zeroes.
    await input.focus();
    await page.keyboard.insertText(code);
    await expect(input).toHaveValue(code);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/account$/);
    expect((await page.context().cookies()).some(cookie => cookie.name === 'uier_sign_in_request')).toBe(false);
    expect((await page.context().cookies()).some(cookie => cookie.name === 'uier_session')).toBe(true);

    const other = await newVisitor(browser, testInfo);
    await other.page.goto(new URL(link, page.url()).href);
    await expect(other.page.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
    await other.context.close();
});

test('another browser with its own request for the same address cannot use the first code or its budget', async ({ page, browser }, testInfo) => {
    const email = uniqueEmail();
    await page.goto('/app/sign-in');
    const first = await requestSignInEmail(page, email);
    const other = await newVisitor(browser, testInfo);
    await other.page.goto(new URL('/app/sign-in', page.url()).href);
    await requestSignInEmail(other.page, email);
    await submitCode(other.page, first.code);
    await expect(other.page.locator('form').getByRole('alert')).toHaveText(codeError);
    // Submit the first request id as well: the signed cookie must still match it.
    const firstId = await page.locator('input[name="requestId"]').inputValue();
    await other.page.locator('input[name="requestId"]').evaluate((input, value) => { (input as HTMLInputElement).value = value; }, firstId);
    for (let attempt = 0; attempt < 6; attempt++) {
        await submitCode(other.page, first.code);
        await expect(other.page.locator('form').getByRole('alert')).toHaveText(codeError);
    }
    expect((await other.context.cookies()).some(cookie => cookie.name === 'uier_session')).toBe(false);
    await submitCode(page, first.code);
    await expect(page).toHaveURL(/\/app\/projects\/new$/);
    await other.context.close();
});

test('using the link in another browser invalidates the requesting page code', async ({ page, browser }, testInfo) => {
    await page.goto('/app/sign-in');
    const { code, link } = await requestSignInEmail(page, uniqueEmail());
    const other = await newVisitor(browser, testInfo);
    await other.page.goto(new URL(link, page.url()).href);
    await other.page.getByRole('button', { name: 'Continue' }).click();
    await expect(other.page).toHaveURL(/\/app\/projects\/new$/);
    await submitCode(page, code);
    await expect(page.locator('form').getByRole('alert')).toHaveText(codeError);
    await expectNoAxeViolations(page);
    expect((await page.context().cookies()).some(cookie => cookie.name === 'uier_session')).toBe(false);
    await other.context.close();
});

test('five wrong codes invalidate both paths and a new email lets the browser continue', async ({ page, browser }, testInfo) => {
    const email = uniqueEmail();
    await page.goto('/app/sign-in?next=%2Fapp%2Faccount');
    const { code, link } = await requestSignInEmail(page, email);
    const wrong = code === '00000000' ? '11111111' : '00000000';
    for (let attempt = 0; attempt < 5; attempt++) {
        await submitCode(page, wrong);
        await expect(page.locator('form').getByRole('alert')).toHaveText(codeError);
        await expect(page.getByLabel('Sign-in code', { exact: true })).toHaveValue(wrong);
    }
    await submitCode(page, code);
    await expect(page.locator('form').getByRole('alert')).toHaveText(codeError);
    const other = await newVisitor(browser, testInfo);
    await other.page.goto(new URL(link, page.url()).href);
    await expect(other.page.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
    await other.context.close();
    await page.getByRole('link', { name: 'Ask for a new email' }).click();
    const fresh = await requestSignInEmail(page, email);
    await submitCode(page, fresh.code);
    await expect(page).toHaveURL(/\/app\/account$/);
});

test('a newer request replaces the browser binding, including in an older tab', async ({ page }) => {
    const email = uniqueEmail();
    await page.goto('/app/sign-in');
    const first = await requestSignInEmail(page, email);
    const newer = await page.context().newPage();
    await newer.goto(new URL('/app/sign-in', page.url()).href);
    const second = await requestSignInEmail(newer, email);
    await submitCode(page, first.code);
    await expect(page.locator('form').getByRole('alert')).toHaveText(codeError);
    await submitCode(newer, second.code);
    await expect(newer).toHaveURL(/\/app\/projects\/new$/);
    await newer.close();
});

test('the sign-in form validates the address', async ({ page }) => {
    await page.goto('/app/sign-in');
    await page.getByLabel('Email').fill('not an email');
    // Bypass the browser's own type="email" check to reach the server validation
    await page.locator('form').evaluate(form => form.setAttribute('novalidate', ''));
    await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
    await expect(page.locator('form').getByRole('alert')).toHaveText('Enter a valid email address.');
    await expect(page.getByLabel('Email')).toHaveValue('not an email');
});

test('onboarding creates a project with its addresses and shows the install guide', async ({ page }) => {
    await signIn(page, uniqueEmail());
    // A new user without projects starts onboarding
    await expect(page).toHaveURL(/\/app\/projects\/new$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Create a project' })).toBeVisible();
    await expect(page).toHaveTitle('Create project · uier');
    // The onboarding progress: the site, the script, then the first reviewer
    const progress = page.getByRole('list', { name: 'Onboarding progress' });
    await expect(progress.getByRole('listitem')).toHaveCount(3);
    await expect(progress.locator('[aria-current="step"]')).toContainText('Step 1 of 3: Your site');
    await expect(progress.getByRole('listitem').nth(1)).toContainText('Step 2 of 3: Add the script');
    await expect(progress.getByRole('listitem').nth(2)).toContainText('Step 3 of 3: Invite a reviewer');
    await expectNoAxeViolations(page);

    const projectId = await createProject(page, { urls: ['www.example.com/', 'https://staging.example.com/app/'] });

    // Install guide (the project's Install tab): the script with the project code, platform guidance and the CSP sources
    await expect(page.getByRole('heading', { level: 1, name: 'example.com' })).toBeVisible();
    await expect(progress.getByRole('listitem').first()).toContainText('Step 1 of 3: Your site (done)');
    await expect(progress.locator('[aria-current="step"]')).toContainText('Step 2 of 3: Add the script');
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText(await projectPublicId(page, projectId), { exact: true })).toBeVisible();
    await expect(page.getByText(`data-uier-project="${await projectPublicId(page, projectId)}"`).first()).toBeVisible();
    await expect(page.getByText('/toolbar.js" data-uier-project=').first()).toContainText('defer></script>');
    await page.getByRole('button', { name: 'Advanced: pin this version', exact: true }).click();
    await expect(page.getByText('integrity="sha384-').first()).toContainText('crossorigin="anonymous"');
    await expect(page.getByText(/It gets fixes only when you update the snippet/).first()).toBeVisible();
    await expect(page.getByText(/Paste it before the closing <\/body> tag/)).toBeVisible();
    for (const platform of ['HTML', 'Next.js', 'React', 'WordPress', 'Webflow', 'Shopify'])
        await expect(page.getByRole('tab', { name: platform })).toBeVisible();
    await page.getByRole('tab', { name: 'Next.js' }).click();
    await expect(page.getByText('strategy="afterInteractive"')).toBeVisible();
    await page.getByRole('button', { name: 'Advanced: pin the Next.js version', exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: 'Next.js' }).getByText('crossOrigin="anonymous"')).toContainText('integrity="sha384-');
    await page.getByText('Advanced: security headers').click();
    await expect(page.getByText(/in proxy\.ts \(middleware\.ts before Next\.js 16\)/)).toBeVisible();
    await expect(page.getByText('connect-src http://')).toBeVisible();
    await expect(page.getByText(/style-src http:\/\/localhost:\d+/)).toBeVisible();
    // Metadata is streamed after the content
    await expect(page).toHaveTitle('Install · uier');
    const reviewerStep = page.getByRole('region', { name: 'Invite a reviewer' });
    await expect(reviewerStep).toContainText('Only people you invite can see and leave comments. They sign in with their email.');
    await expect(reviewerStep.locator('code')).toHaveCount(0);
    for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`));
        await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
        await expectNoAxeViolations(page);
        await reviewerStep.getByRole('button', { name: 'Invite', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Invite someone' });
        await expect(dialog.getByRole('checkbox', { name: 'example.com', exact: true })).toBeChecked();
        await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
        await expectNoAxeViolations(page);
        await page.keyboard.press('Escape');
    }

    // The project, with both addresses normalized
    await page.getByRole('link', { name: 'Go to the comments' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${projectId}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'example.com' })).toBeVisible();
    await expect(page).toHaveTitle('example.com · uier');
    await expect(page.getByText('No comments yet')).toBeVisible();
    const empty = page.locator('[data-slot="empty"]');
    await expect(empty).toContainText('They sign in with their email.');
    await expect(empty.getByRole('button', { name: 'Invite', exact: true })).toBeVisible();
    // Open review: Review or Visit site for each address, the main site first
    await page.getByRole('button', { name: 'Open review' }).click();
    const mainSite = page.getByRole('group', { name: 'www.example.com' });
    await expect(mainSite).toContainText('Main site');
    await expect(mainSite.getByRole('menuitem', { name: 'Review' })).toBeVisible();
    await expect(mainSite.getByRole('menuitem', { name: 'Visit site' })).toHaveAttribute('href', 'https://www.example.com');
    await expect(page.getByRole('group', { name: 'staging.example.com/app' }).getByRole('menuitem', { name: 'Review' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expectNoAxeViolations(page);

    // The install guide, from Settings, is the plain guide without the onboarding progress
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('link', { name: 'Open install guide' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${projectId}/install$`));
    await expect(page.getByRole('heading', { name: 'Copy the script' })).toBeVisible();
    await expect(progress).toHaveCount(0);
    await expect(reviewerStep).toHaveCount(0);
});

test('review links open the project\'s own sites with the toolbar turned on', async ({ page }) => {
    await signIn(page, uniqueEmail());
    const projectId = await createProject(page, { urls: ['https://example.com', 'https://staging.example.com'] });
    const request = page.request;

    // The target, without the single-use review code the toolbar exchanges for a review token
    const location = async (query: string) => {
        const response = await request.get(`/app/review/${projectId}${query}`, { maxRedirects: 0 });
        expect(response.status()).toBe(307);
        const target = new URL(response.headers()['location'] ?? '');
        expect(target.searchParams.get('uier-token')).toMatch(/^[A-Za-z0-9_-]{43}$/);
        target.searchParams.delete('uier-token');
        return target.toString();
    };

    expect(await location('')).toBe(`https://example.com/?toolbar-code=${await projectPublicId(page, projectId)}`);
    expect(await location(`?url=${encodeURIComponent('https://staging.example.com/pricing?plan=1')}`))
        .toBe(`https://staging.example.com/pricing?plan=1&toolbar-code=${await projectPublicId(page, projectId)}`);
    // A missing comment has no known original source and must not be retargeted to the main site.
    const missing = await request.get(`/app/review/${projectId}?comment=comment_abc123`, { maxRedirects: 0 });
    expect(missing.status()).toBe(404);
    expect(await missing.text()).toContain('original site address may have been removed');
    // Another site is never a redirect target
    expect(await location(`?url=${encodeURIComponent('https://evil.example.net/')}`)).toBe(`https://example.com/?toolbar-code=${await projectPublicId(page, projectId)}`);

    // Someone without access to the project gets nothing
    const response = await request.get('/app/review/aaaaaaaaaaaa', { maxRedirects: 0 });
    expect(response.status()).toBe(404);
});

test('projects can be marked as done and reopened', async ({ page }) => {
    await signIn(page, uniqueEmail());
    await createProject(page, { urls: ['done.example.com'], name: 'Launch site' });

    await page.goto('/app/projects');
    const active = page.getByRole('list', { name: 'Active projects' });
    await expect(active.getByRole('link', { name: 'Launch site' })).toBeVisible();
    await expect(page).toHaveTitle('Projects · uier');
    await expectNoAxeViolations(page);

    await active.getByRole('button', { name: 'More actions for Launch site' }).click();
    await page.getByRole('menuitem', { name: 'Mark as done' }).click();
    await expect(page.getByText('No active projects')).toBeVisible();

    await page.getByRole('link', { name: /^Done/ }).click();
    const done = page.getByRole('list', { name: 'Done projects' });
    await expect(done.getByRole('link', { name: 'Launch site' })).toBeVisible();

    // The saved state, after a reload
    await page.reload();
    await done.getByRole('button', { name: 'More actions for Launch site' }).click();
    await page.getByRole('menuitem', { name: 'Reopen' }).click();
    await expect(page.getByText('No done projects')).toBeVisible();
    await page.getByRole('link', { name: /^Active/ }).click();
    await expect(page.getByRole('list', { name: 'Active projects' }).getByRole('link', { name: 'Launch site' })).toBeVisible();
});

test('project settings save the comment access, addresses and name', async ({ page }) => {
    await signIn(page, uniqueEmail());
    const projectId = await createProject(page, { urls: ['settings.example.com'] });
    await page.goto(`/app/projects/${projectId}/settings`);
    await expect(page.getByRole('heading', { level: 1, name: 'settings.example.com' })).toBeVisible();
    // The header's Settings button is current (the breadcrumb ends at Settings too, as a disabled link)
    await expect(page.getByRole('link', { name: 'Settings', exact: true, disabled: false })).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveTitle('Project settings · uier');
    await expectNoAxeViolations(page);

    // Who can comment
    const access = page.getByRole('region', { name: 'Who can comment' });
    await expect(access.getByRole('radio', { name: 'Invited people' })).toBeChecked();
    await setProjectAccess(page, projectId, 'Anyone with the link');

    // Addresses
    const addresses = page.getByRole('region', { name: 'Site addresses' });
    await addresses.getByLabel('Address 2', { exact: true }).fill('localhost:3000/');
    await addresses.getByRole('button', { name: 'Save' }).click();
    await expect(addresses.getByRole('status')).toHaveText('The addresses are saved.');
    await addresses.getByLabel('Address 2', { exact: true }).fill('not a site');
    await addresses.getByRole('button', { name: 'Save' }).click();
    await expect(addresses.getByRole('alert')).toContainText('"not a site" is not a website address.');

    // Name
    const general = page.getByRole('region', { name: 'General' });
    await general.getByLabel('Project name').fill('Marketing site');
    await general.getByRole('button', { name: 'Save' }).click();
    await expect(general.getByRole('status')).toHaveText('The name is saved.');

    await page.reload();
    await expect(access.getByRole('radio', { name: 'Anyone with the link' })).toBeChecked();
    await expect(addresses.getByLabel('Main site address')).toHaveValue('https://settings.example.com');
    await expect(addresses.getByLabel('Address 2', { exact: true })).toHaveValue('http://localhost:3000');
    // The new name in the header and the breadcrumbs, and on the projects page
    await expect(page.getByRole('heading', { level: 1, name: 'Marketing site' })).toBeVisible();
    await page.goto('/app/projects');
    await expect(page.getByRole('list', { name: 'Active projects' }).getByRole('link', { name: 'Marketing site' })).toBeVisible();
});

test('the sidebar has the sections, the active projects and the account', async ({ page }) => {
    await signIn(page, uniqueEmail('sidebar'));
    const projectId = await createProject(page, { urls: ['sidebar.example.com'], name: 'Sidebar site' });

    const navigation = await appNavigation(page);
    await expect(navigation.getByRole('link', { name: 'All projects' })).toBeVisible();
    await expect(navigation.getByRole('link', { name: 'Create project' })).toBeVisible();
    await expect(navigation.getByRole('link', { name: 'Users' })).toBeVisible();
    await navigation.getByRole('link', { name: 'Sidebar site' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${projectId}$`));
    // Small screens close the sheet after a link
    await closeAppNavigation(page);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Sidebar site');
    await expect(page).toHaveTitle('Sidebar site · uier');
    await expectNoAxeViolations(page);
    await expect((await appNavigation(page)).getByRole('link', { name: 'Sidebar site' })).toHaveAttribute('aria-current', 'page');

    // Billing is gone: uier is free, so there is nothing to bill
    await expect(page.getByRole('link', { name: 'Billing' })).toHaveCount(0);
    expect((await page.request.get('/app/billing')).status()).toBe(404);

    // The account menu: account page and theme
    await page.getByRole('button', { name: /^Account: / }).click();
    await page.getByRole('menuitem', { name: 'Theme' }).click();
    await page.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
});

test('admins rename the workspace from its menu; commenters have no workspace settings', async ({ page }) => {
    const email = uniqueEmail('workspace-settings');
    await signIn(page, email);
    await createProject(page, { urls: ['workspace.example.com'], name: 'Workspace site' });

    // The workspace menu at the top of the sidebar opens the settings
    await appNavigation(page);
    await page.getByRole('button', { name: /^Workspace:/ }).click();
    await page.getByRole('menuitem', { name: 'Workspace settings' }).click();
    await expect(page).toHaveURL(/\/app\/settings$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Workspace settings' })).toBeVisible();
    await expect(page).toHaveTitle('Workspace settings · uier');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Workspace settings');

    // A new workspace is named after its creator's email until an admin renames it
    const name = page.getByLabel('Workspace name');
    await expect(name).toHaveValue(email);
    await name.fill('  Acme   studio ');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'The workspace name is saved.' })).toBeVisible();
    await expectNoAxeViolations(page);

    // The sidebar shows the new name; the settings are only in the workspace menu
    const navigation = await appNavigation(page);
    await expect(navigation.getByRole('link', { name: 'Workspace settings' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Workspace:/ })).toContainText('Acme studio');
    await closeAppNavigation(page);
    await page.reload();
    await expect(page.getByLabel('Workspace name')).toHaveValue('Acme studio');

    // In the uier workspace everyone joins as a commenter: no settings link, and the page is not there
    await appNavigation(page);
    await page.getByRole('button', { name: /^Workspace:/ }).click();
    await expect(page.getByRole('menuitem', { name: /Acme studio.*Admin/ })).toBeVisible();
    await page.getByRole('menuitem', { name: /uier.*Commenter/ }).click();
    await expect(page).toHaveURL(/\/app\/projects$/);
    const commenterNavigation = await appNavigation(page);
    await expect(commenterNavigation.getByRole('link', { name: 'Workspace settings' })).toHaveCount(0);
    await page.getByRole('button', { name: /^Workspace:/ }).click();
    await expect(page.getByRole('menuitem', { name: /uier.*Commenter/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Workspace settings' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.goto('/app/settings');
    await expect(page).toHaveURL(/\/app\/projects$/);
});

test('anyone creates a workspace from its menu and lands on its first project', async ({ page }) => {
    await signIn(page, uniqueEmail('workspace-create'));
    await createProject(page, { urls: ['first.example.com'], name: 'First site' });

    await appNavigation(page);
    await page.getByRole('button', { name: /^Workspace:/ }).click();
    await page.getByRole('menuitem', { name: 'Create workspace' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create workspace' });
    await expect(dialog.getByLabel('Workspace name')).toBeFocused();
    // The menu fades out as the dialog fades in: scan once both are done
    await expect(page.getByRole('menu')).toHaveCount(0);
    await animationsFinished(dialog);
    await expectNoAxeViolations(page);
    await dialog.getByLabel('Workspace name').fill('  Client   work ');
    await dialog.getByRole('button', { name: 'Create workspace' }).click();

    // The new workspace is current, empty and the creator is its admin
    await expect(page).toHaveURL(/\/app\/projects\/new$/);
    await appNavigation(page);
    await expect(page.getByRole('button', { name: /^Workspace:/ })).toContainText('Client work');
    await expect(page.getByRole('button', { name: /^Workspace:/ })).toContainText('Admin');
    await page.getByRole('button', { name: /^Workspace:/ }).click();
    await expect(page.getByRole('menuitem', { name: /Client work.*Admin/ })).toBeVisible();
    await page.getByRole('menuitem', { name: /@example\.com.*Admin/ }).click();
    await expect(page).toHaveURL(/\/app\/projects$/);
    await expect(page.getByRole('link', { name: 'First site' }).first()).toBeVisible();
});

test('feedback on the app opens uier\'s toolbar and stays private', async ({ page, browser }, testInfo) => {
    // An earlier guest identity must not override the signed-in account.
    const guestWrite = await page.request.post('/api/comments', { data: {
        path: `/e2e/guest-before-sign-in-${Date.now()}-${testInfo.project.name}`, kind: 'feedback', position: { type: 'page' }, text: 'Guest feedback'
    } });
    expect(guestWrite.status(), await guestWrite.text()).toBe(201);
    const guest = await (await page.request.get('/api/visitor')).json();
    expect(guest.name).toMatch(/^Guest /);
    const email = uniqueEmail('feedback');
    await signIn(page, email);
    const name = email.split('@')[0]!;
    const member = await (await page.request.get('/api/visitor')).json();
    expect(member).toMatchObject({ name, member: true });
    expect(member.draftScope).not.toBe(guest.draftScope);
    await page.goto('/app/projects');
    // In the sidebar's footer, with the account (not in the navigation)
    const giveFeedback = page.getByRole('button', { name: 'Give feedback' });
    await appNavigation(page);
    await giveFeedback.click();

    // The toolbar mounts with its feedback form open
    const dialog = page.getByRole('dialog', { name: 'Send feedback' });
    const text = `Projects could use search ${Date.now().toString(36)}`;
    await expect(dialog.getByRole('textbox', { name: 'Feedback' })).toBeFocused();
    await expect(showcaseHint(page)).toHaveCount(0);
    await dialog.getByRole('textbox', { name: 'Feedback' }).fill(text);
    await dialog.getByRole('button', { name: 'Send feedback' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Feedback sent' })).toBeAttached();
    // The app has no "About uier": only the landing page introduces uier
    await expect(page.getByRole('button', { name: 'About uier' })).toHaveCount(0);
    expect(await (await page.request.get('/api/visitor?path=%2Fapp%2Fprojects')).json()).toMatchObject({ privateAppFeedback: true });
    expect(await (await page.request.get('/api/visitor?path=%2Fapplication')).json()).toMatchObject({ privateAppFeedback: false });
    await expect(showcaseHint(page)).toHaveCount(0);
    await toolbar(page).getByRole('button', { name: 'Profile', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Profile', exact: true })).toContainText(name);
    await expect(page.getByRole('dialog', { name: 'Profile', exact: true })).toContainText('You are signed in to uier.');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Profile', exact: true })).toBeHidden();
    await expectNoAxeViolations(page);

    // App pages show private projects: only the author (and the team, in the app) sees it
    const pageComments = new URL('/api/comments?path=/app/projects', page.url()).href;
    const siteComments = new URL('/api/comments?scope=site', page.url()).href;
    const texts = (comments: { thread: { items: { text: string }[] } }[]) => comments.map(comment => comment.thread.items[0]?.text);
    const saved = (await (await page.request.get(pageComments)).json()).find((comment: { thread: { items: { text: string }[] } }) => comment.thread.items[0]?.text === text);
    expect(saved.isMine).toBe(true);
    expect(saved.thread.items[0].author).toEqual({ name, isMe: true });
    const other = await newVisitor(browser, testInfo);
    expect(texts(await (await other.context.request.get(pageComments)).json())).not.toContain(text);
    expect(texts(await (await other.context.request.get(siteComments)).json())).not.toContain(text);
    await other.context.close();

    // Closed from its options, and back with the button
    await toolbar(page).getByRole('button', { name: 'Options' }).click();
    await page.getByRole('button', { name: 'Close toolbar' }).click();
    await expect(toolbar(page)).toBeHidden();
    await appNavigation(page);
    await giveFeedback.click();
    await expect(dialog).toBeVisible();

    // All app users can switch to the shared feedback project as commenters, and see their
    // own feedback under the same identity used by the toolbar. A second account cannot see it.
    await page.goto('/app/projects');
    await appNavigation(page);
    await page.getByRole('button', { name: /^Workspace:/ }).click();
    await page.getByRole('menuitem', { name: /uier.*Commenter/ }).click();
    await expect(page.getByRole('list', { name: 'Active projects' }).getByRole('link', { name: 'uier.io public feedback' }))
        .toHaveAttribute('href', '/app/projects/uier00000001');
    await page.goto('/app/projects/uier00000001');
    // This local feedback has a loopback origin, outside the public project's production environment.
    await expect(page.getByRole('button', { name: /^Environment and page:/ })).toContainText('All environments and pages');
    await expect(page.getByRole('article', { name: 'Comment by you' }).filter({ hasText: text })).toBeVisible();
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Email notifications', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Who can comment', exact: true })).toHaveCount(0);

    const second = await newVisitor(browser, testInfo);
    await signIn(second.page, uniqueEmail('feedback-other'), { from: new URL('/app/sign-in', page.url()).href });
    expect(texts(await (await second.context.request.get(pageComments)).json())).not.toContain(text);
    await second.context.close();

    const staff = await newVisitor(browser, testInfo);
    const staffDevice = testInfo.project.name.startsWith('Mobile') ? 'mobile' : 'desktop';
    await signIn(staff.page, `e2e-public-staff-${staffDevice}@example.test`, { from: new URL('/app/sign-in', page.url()).href });
    // The same-origin toolbar stays author-only, including for staff.
    expect(texts(await (await staff.context.request.get(pageComments)).json())).not.toContain(text);
    await appNavigation(staff.page);
    await staff.page.getByRole('button', { name: /^Workspace:/ }).click();
    await staff.page.getByRole('menuitem', { name: /uier.*Admin/ }).click();
    await expect(staff.page.getByRole('list', { name: 'Active projects' }).getByRole('link', { name: 'uier.io public feedback', exact: true })).toBeVisible();
    await staff.page.goto(new URL('/app/projects/uier00000001?environment=all', page.url()).href);
    await expect(staff.page.getByRole('article').filter({ hasText: text })).toBeVisible();
    await staff.context.close();

    // The same account in a fresh browser can still read and manage its earlier feedback.
    const returning = await newVisitor(browser, testInfo);
    await signIn(returning.page, email, { from: new URL('/app/sign-in', page.url()).href });
    const sameAccount = (await (await returning.context.request.get(pageComments)).json()).find((comment: { id: string }) => comment.id === saved.id);
    expect(sameAccount.isMine).toBe(true);
    await returning.context.close();
});

test('the account page saves the name and signs out', async ({ page }) => {
    await signIn(page, uniqueEmail('account'));
    await page.goto('/app/account');
    await expect(page.getByLabel('Name')).toHaveValue(/^account-/);
    await page.getByLabel('Name').fill('Mia Reviewer');
    await page.getByRole('button', { name: 'Save' }).click();
    // The coding agents' copy buttons have their own (empty) status regions
    await expect(page.getByRole('region', { name: 'Profile' }).getByRole('status')).toHaveText('Your name is saved.');
    await appNavigation(page);
    await expect(page.getByRole('button', { name: 'Account: Mia Reviewer' })).toBeVisible();
    await closeAppNavigation(page);
    await expect(page).toHaveTitle('Account · uier');
    await expectNoAxeViolations(page);

    await page.getByRole('region', { name: 'Sign out' }).getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/app\/sign-in$/);
    expect((await page.context().cookies()).some(cookie => cookie.name === '__Secure-uier_review_sso')).toBe(false);
    await page.goto('/app/projects');
    await expect(page).toHaveURL(/\/app\/sign-in\?next=/);
});

test('only admins save and clear the plain-text review brief, with server validation', async ({ page, browser }, testInfo) => {
    await signIn(page, uniqueEmail('brief-admin'));
    const project = await createProject(page, { urls: [new URL(page.url()).origin], name: 'Brief review' });
    await page.goto(`/app/projects/${project}/settings`);
    const section = page.getByRole('region', { name: 'Review brief', exact: true });
    const input = section.getByLabel('Review instructions');
    await expect(section).toContainText('Only invited people who can comment can read this brief.');
    await input.fill('  Review pricing.\nThen checkout.  ');
    const savedRequest = page.waitForRequest(request => request.method() === 'POST' && Boolean(request.headers()['next-action']));
    await section.getByRole('button', { name: 'Save' }).click();
    const actionRequest = await savedRequest;
    await expect(section.getByRole('status')).toHaveText('The review brief is saved.');
    await page.reload();
    await expect(input).toHaveValue('Review pricing.\nThen checkout.');
    // Bypass the browser maxLength: the action must enforce the shared server limit too.
    await input.evaluate((element: HTMLTextAreaElement) => element.removeAttribute('maxlength'));
    await input.fill('x'.repeat(2001));
    await section.getByRole('button', { name: 'Save' }).click();
    await expect(section.getByRole('alert')).toBeVisible();
    await page.reload();
    await expect(input).toHaveValue('Review pricing.\nThen checkout.');

    const email = uniqueEmail('brief-member');
    await page.goto(`/app/projects/${project}`);
    await openProjectInvite(page);
    const invitation = page.getByRole('dialog');
    await invitation.getByLabel('Email').fill(email);
    await invitation.getByRole('button', { name: 'Send invitation' }).click();
    const link = await invitation.getByRole('link', { name: 'Open the invitation link' }).getAttribute('href');
    const member = await newVisitor(browser, testInfo);
    try {
        await member.page.goto(link!);
        await member.page.getByRole('button', { name: 'Accept invitation' }).click();
        const publicId = await projectPublicId(page, project);
        await member.page.waitForURL(url => url.searchParams.get('toolbar-code') === publicId);
        // Wait for invitation acceptance and its cookies before inspecting settings.
        await member.page.goto(`/app/projects/${project}/settings`);
        await expect(member.page.getByRole('heading', { name: 'Settings', exact: true })).toBeAttached();
        await expect(member.page.getByRole('region', { name: 'Review brief' })).toHaveCount(0);
        const response = await member.page.request.post(actionRequest.url(), {
            headers: { 'Next-Action': actionRequest.headers()['next-action']!, 'Content-Type': actionRequest.headers()['content-type']!, Origin: new URL(actionRequest.url()).origin },
            data: Buffer.from(actionRequest.postDataBuffer()!.toString().replace('Review pricing.', 'Changed by member.'))
        });
        expect(await response.text()).toContain('Only admins can do this.');
    } finally { await member.context.close(); }
    await page.goto(`/app/projects/${project}/settings`);
    await expect(input).toHaveValue('Review pricing.\nThen checkout.');
    // Clear the existing brief explicitly before exercising a whitespace-only submission.
    await input.clear();
    await input.fill(' \n ');
    await expect(input).toHaveValue(' \n ');
    await section.getByRole('button', { name: 'Save' }).click();
    await expect(section.getByRole('status')).toHaveText('The review brief is saved.');
    await page.reload();
    await expect(input).toHaveValue('');
});


test('a suppressed address can sign in and then receive invitations again', async ({ page, browser }) => {
    const email = uniqueEmail('bounced-sign-in');
    await seedEmailBounce(page.request, email);
    await signIn(page, email);
    await expect(page.getByText('Email to this address bounced.', { exact: false })).toHaveCount(0);
    const admin = await browser.newPage();
    await signIn(admin, uniqueEmail('invite-admin'));
    await admin.goto('/app/users');
    await admin.getByRole('button', { name: 'Invite', exact: true }).click();
    const dialog = admin.getByRole('dialog');
    await dialog.getByLabel('Email', { exact: true }).fill(email);
    await dialog.getByRole('radio', { name: 'All projects, now and later' }).click();
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(dialog).toHaveAccessibleName('Invitation sent');
    await admin.close();
});

test('staff moderate public feedback with opaque author filters, single-reply deletion and screenshot cleanup', async ({ page, browser }, testInfo) => {
    const key = `${Date.now()}-${testInfo.project.name}`;
    const guest = await newVisitor(browser, testInfo);
    const other = await newVisitor(browser, testInfo);
    const create = async (context: typeof guest.context, text: string, screenshot = false) => {
        const response = await context.request.post(new URL('/api/comments', page.url()).href, { data: {
            path: `/moderation-${key}`, kind: 'feedback', position: { type: 'page' }, text, ...(screenshot ? { screenshot: pngImage } : {})
        } });
        expect(response.status()).toBe(201); return response.json();
    };
    await page.goto('/');
    const opened = await create(guest.context, `Opened by target ${key}`, true);
    const replied = await create(other.context, `Replied by target ${key}`);
    const unrelated = await create(other.context, `Unrelated author ${key}`);
    const replyResponse = await guest.context.request.post(new URL(`/api/comments/${replied.id}/replies`, page.url()).href, { data: { text: `Target reply ${key}` } });
    expect(replyResponse.ok()).toBe(true);
    expect((await replyResponse.json()).thread.items).toHaveLength(2);
    const device = testInfo.project.name.startsWith('Mobile') ? 'mobile' : 'desktop';
    await signIn(page, `e2e-public-staff-${device}@example.test`);
    // Becoming staff must not select the shared workspace or bypass personal onboarding.
    await expect(page).toHaveURL(/\/app\/projects\/new$/);
    await appNavigation(page);
    await page.getByRole('button', { name: /^Workspace:/ }).click();
    await page.getByRole('menuitem', { name: /uier.*Admin/ }).click();
    await expect(page.getByRole('list', { name: 'Active projects' }).getByRole('link', { name: 'uier.io public feedback', exact: true })).toBeVisible();
    await page.goto('/app/projects/uier00000001?environment=all');
    const card = (text: string) => page.getByRole('article').filter({ hasText: `${text} ${key}` });
    await expect(card('Opened by target')).toBeVisible();
    await expect(card('Unrelated author')).toBeVisible();
    await card('Opened by target').getByRole('button', { name: /^More actions/ }).click();
    await page.getByRole('menuitem', { name: 'More from this author', exact: true }).click();
    await expect(page).toHaveURL(/author=[A-Za-z0-9_-]{43}/);
    expect(page.url()).not.toContain('user:');
    await expect(card('Opened by target')).toBeVisible();
    await expect(card('Replied by target')).toBeVisible();
    await expect(card('Unrelated author')).toHaveCount(0);
    const authorQuery = new URL(page.url()).searchParams.get('author');
    await page.reload();
    await expect(card('Replied by target')).toBeVisible();
    const replyActions = card('Replied by target').getByRole('button', { name: /^More actions for reply by/ });
    await replyActions.click();
    await page.getByRole('menuitem', { name: 'Delete reply', exact: true }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete this reply?' });
    await expect(confirm).toContainText('The reply is deleted for everyone.');
    for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`));
        await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
        await expectNoAxeViolations(page);
    }
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(card('Replied by target')).toHaveCount(0); // No remaining participation by that author.
    await page.getByRole('button', { name: /^Clear author filter:/ }).click();
    await expect(card('Replied by target')).toBeVisible();
    await expect(card('Replied by target').getByText(`Target reply ${key}`)).toHaveCount(0);
    expect((await page.request.get(`/app/projects/uier00000001/comments/${opened.id}/screenshot`)).status()).toBe(200);
    await card('Opened by target').getByRole('button', { name: /^More actions/ }).click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(card('Opened by target')).toHaveCount(0);
    expect((await page.request.get(`/app/projects/uier00000001/comments/${opened.id}/screenshot`)).status()).toBe(404);
    expect((await guest.context.request.get(new URL(`/api/comments?path=/moderation-${key}`, page.url()).href)).ok()).toBe(true);
    const commenter = await newVisitor(browser, testInfo);
    try {
        await signIn(commenter.page, uniqueEmail('no-author-filter'), { from: new URL('/app/sign-in', page.url()).href });
        await appNavigation(commenter.page);
        await commenter.page.getByRole('button', { name: /^Workspace:/ }).click();
        await commenter.page.getByRole('menuitem', { name: /uier.*Commenter/ }).click();
        await expect(commenter.page.getByRole('list', { name: 'Active projects' }).getByRole('link', { name: 'uier.io public feedback', exact: true })).toBeVisible();
        await commenter.page.goto(new URL('/app/projects/uier00000001?environment=all', page.url()).href);
        const otherCard = commenter.page.getByRole('article').filter({ hasText: `Unrelated author ${key}` });
        await otherCard.getByRole('button', { name: /^More actions/ }).click();
        await expect(commenter.page.getByRole('menuitem', { name: 'More from this author', exact: true })).toHaveCount(0);
        await commenter.page.keyboard.press('Escape');
        await expect(commenter.page.getByRole('button', { name: /^Clear author filter:/ })).toHaveCount(0);
        expect((await commenter.context.request.get(new URL(`/app/projects/uier00000001?author=${authorQuery}`, page.url()).href)).status()).toBe(404);
    } finally { await commenter.context.close(); await guest.context.close(); await other.context.close(); }
});
