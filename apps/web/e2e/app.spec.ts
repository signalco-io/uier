import { seedEmailBounce } from './support/emailReports';
import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { projectPublicId, appNavigation, closeAppNavigation, createProject, hydrated, openEmailSignIn, openProjectInvite, requestSignInEmail, setProjectAccess, signIn, uniqueEmail, backToComments, commentRowLink, openComment, openCommentFilters } from './support/app';
import { pngImage } from './support/images';
import { animationsFinished, newVisitor, showcaseHint, toolbar } from './support/toolbar';

// The signed-in app (issue #34): sign-in, onboarding, the sidebar, projects, project settings and the account.

test('signed-out visitors are sent to sign in and come back afterwards', { tag: '@smoke' }, async ({ page }) => {
    await page.goto('/app/account');
    await expect(page).toHaveURL(/\/app\/sign-in\?next=%2Fapp%2Faccount$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expect(page).toHaveTitle('Sign in · uier');
    // Every option is the same outline button with the method's name; email comes last and opens its form in place
    const options = page.getByRole('main').locator('[data-slot=button]');
    await expect(options).toHaveText(['Passkey', 'Google', 'Microsoft', 'Email']);
    await expect(options.first()).toHaveAccessibleName('Sign in with a passkey');
    // A browser that never signed in has no "Last used" option
    await expect(page.getByText('Last used')).toHaveCount(0);
    await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0);
    await expectNoAxeViolations(page);

    await signIn(page, uniqueEmail(), { from: page.url() });
    await expect(page).toHaveURL(/\/app\/account$/);
});

test('a sign-in link works once', { tag: '@smoke' }, async ({ page, browser }) => {
    const email = uniqueEmail();
    await page.goto('/app/sign-in');
    const field = await openEmailSignIn(page);
    await expect(field).toBeFocused();
    await field.fill(email);
    await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
    // The code step has its own header, and the code field is ready to type in
    await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText(`We sent a code and a sign-in link to ${email}`);
    await expect(page.getByText('Choose how to sign in.')).toHaveCount(0);
    await expect(page.getByLabel('Sign-in code', { exact: true })).toBeFocused();
    const link = await page.getByRole('link', { name: 'Open the sign-in link' }).getAttribute('href');
    expect(link).toMatch(/^\/app\/sign-in\/confirm\?token=/);

    // Opening the link (as an email scanner does) does not use it up
    await page.goto(link!);
    await page.goto(link!);
    await page.getByRole('button', { name: 'Continue' }).click();
    // A new account starts with its first-run step
    await expect(page).toHaveURL(/\/app\/welcome$/);

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
    await expect(page).toHaveURL(/\/app\/welcome$/);
    await other.context.close();
});

test('using the link in another browser invalidates the requesting page code', async ({ page, browser }, testInfo) => {
    await page.goto('/app/sign-in');
    const { code, link } = await requestSignInEmail(page, uniqueEmail());
    const other = await newVisitor(browser, testInfo);
    await other.page.goto(new URL(link, page.url()).href);
    await other.page.getByRole('button', { name: 'Continue' }).click();
    await expect(other.page).toHaveURL(/\/app\/welcome$/);
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
    await expect(newer).toHaveURL(/\/app\/welcome$/);
    await newer.close();
});

test('the sign-in form validates the address', async ({ page }) => {
    await page.goto('/app/sign-in');
    await (await openEmailSignIn(page)).fill('not an email');
    // Bypass the browser's own type="email" check to reach the server validation
    await page.locator('form').evaluate(form => form.setAttribute('novalidate', ''));
    await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
    await expect(page.locator('form').getByRole('alert')).toHaveText('Enter a valid email address.');
    await expect(page.getByLabel('Email')).toHaveValue('not an email');
});

test('a new account confirms its name and its workspace name once', async ({ page }) => {
    const email = uniqueEmail('maya.tester');
    await signIn(page, email, { welcome: 'stay' });
    await expect(page).toHaveURL(/\/app\/welcome$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome to uier' })).toBeVisible();
    await expect(page).toHaveTitle('Welcome · uier');
    // Suggestions: the name from the email, the workspace from its domain
    const suffix = email.split('@')[0]!.split('-')[1]!;
    const name = page.getByLabel('Your name', { exact: true });
    await expect(name).toHaveValue(`Maya Tester ${suffix.charAt(0).toUpperCase()}${suffix.slice(1)}`);
    await expect(name).toBeFocused();
    await expect(page.getByLabel('Workspace name', { exact: true })).toHaveValue('Example');
    await expectNoAxeViolations(page);

    // Both names are checked on the server before either is saved
    await page.getByLabel('Workspace name', { exact: true }).fill(' ');
    await page.locator('form').first().evaluate(form => form.setAttribute('novalidate', ''));
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('form').getByRole('alert')).toHaveText('Enter a workspace name.');
    await name.fill('Maya Tester');
    await page.getByLabel('Workspace name', { exact: true }).fill('  Maya   studio ');
    await page.getByRole('button', { name: 'Continue' }).click();

    // Then onboarding, in the named workspace
    await expect(page).toHaveURL(/\/app\/projects\/new$/);
    await appNavigation(page);
    await expect(page.getByRole('button', { name: /^Workspace:/ })).toContainText('Maya studio');
    await closeAppNavigation(page);
    await page.goto('/app/account');
    await expect(page.getByLabel('Name')).toHaveValue('Maya Tester');
    // Only once
    await page.goto('/app/welcome');
    await expect(page).toHaveURL(/\/app\/projects\/new$/);
});

test('skipping the first-run step keeps both names', async ({ page }) => {
    const email = uniqueEmail('skipper');
    await signIn(page, email, { welcome: 'stay' });
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/projects\/new$/);
    await appNavigation(page);
    await expect(page.getByRole('button', { name: /^Workspace:/ })).toContainText(email);
    await closeAppNavigation(page);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/app\/projects\/new$/);
});

test('onboarding creates a project with its addresses and sets up reviews one step at a time', async ({ page }) => {
    await signIn(page, uniqueEmail());
    // A new user without projects starts onboarding
    await expect(page).toHaveURL(/\/app\/projects\/new$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Create a project' })).toBeVisible();
    await expect(page).toHaveTitle('Create project · uier');
    // The onboarding progress: the site, the script, the check, then the first reviewer
    const progress = page.getByRole('list', { name: 'Onboarding progress' });
    await expect(progress.getByRole('listitem')).toHaveCount(4);
    await expect(progress.locator('[aria-current="step"]')).toContainText('Step 1 of 4: Your site');
    await expect(progress.getByRole('listitem').nth(1)).toContainText('Step 2 of 4: Add the script');
    await expect(progress.getByRole('listitem').nth(2)).toContainText('Step 3 of 4: Check installation');
    await expect(progress.getByRole('listitem').nth(3)).toContainText('Step 4 of 4: Invite a reviewer');
    // Nothing to go to before the project exists
    await expect(progress.getByRole('link')).toHaveCount(0);
    // The project name's placeholder is the name the main address gives it
    await page.getByLabel('Main site address').fill('www.shop.example.com/');
    await expect(page.getByLabel('Project name')).toHaveAttribute('placeholder', 'shop.example.com');
    // Every address field is as wide as the first
    await page.getByLabel('Address 2', { exact: true }).fill('staging.example.com');
    const widths = await page.getByRole('group', { name: 'Site addresses' }).locator('[data-slot="input-group"]')
        .evaluateAll(groups => groups.map(group => group.getBoundingClientRect().width));
    expect(widths).toHaveLength(3);
    expect(new Set(widths).size).toBe(1);
    await expectNoAxeViolations(page);

    const projectId = await createProject(page, { urls: ['www.example.com/', 'https://staging.example.com/app/'] });
    const publicId = await projectPublicId(page, projectId);

    // Step 2: the script, with the project code shown once (in the snippet), platform guidance and the CSP sources
    await expect(page.getByRole('heading', { level: 1, name: 'example.com' })).toBeVisible();
    await expect(progress.getByRole('listitem').first()).toContainText('Step 1 of 4: Your site (done)');
    await expect(progress.locator('[aria-current="step"]')).toContainText('Step 2 of 4: Add the script');
    await expect(page.getByRole('navigation', { name: 'Project' }).getByRole('link', { name: 'Install', exact: true })).toHaveAttribute('aria-current', 'page');
    const scriptStep = page.getByRole('region', { name: 'Add the script' });
    await expect(scriptStep.getByText(/Paste it before the closing <\/body> tag/)).toBeVisible();
    await expect(scriptStep.getByText(`data-uier-project="${publicId}"`)).toBeVisible();
    await expect(page.getByText(publicId)).toHaveCount(1);
    await expect(scriptStep.getByText('/toolbar.js" data-uier-project=')).toContainText('defer></script>');
    await scriptStep.getByRole('button', { name: 'Advanced: pin this version', exact: true }).click();
    await expect(scriptStep.getByText('integrity="sha384-').first()).toContainText('crossorigin="anonymous"');
    await expect(scriptStep.getByText(/It gets fixes only when you update the snippet/).first()).toBeVisible();
    for (const platform of ['HTML', 'Next.js', 'React', 'WordPress', 'Webflow', 'Shopify'])
        await expect(scriptStep.getByRole('tab', { name: platform })).toBeVisible();
    await scriptStep.getByRole('tab', { name: 'Next.js' }).click();
    await expect(scriptStep.getByText('strategy="afterInteractive"')).toBeVisible();
    await scriptStep.getByRole('button', { name: 'Advanced: pin the Next.js version', exact: true }).click();
    await expect(scriptStep.getByRole('tabpanel', { name: 'Next.js' }).getByText('crossOrigin="anonymous"')).toContainText('integrity="sha384-');
    await scriptStep.getByText('Advanced: security headers').click();
    await expect(scriptStep.getByText(/in proxy\.ts \(middleware\.ts before Next\.js 16\)/)).toBeVisible();
    await expect(scriptStep.getByText('connect-src http://')).toBeVisible();
    await expect(scriptStep.getByText(/style-src http:\/\/localhost:\d+/)).toBeVisible();
    // Metadata is streamed after the content
    await expect(page).toHaveTitle('Install · uier');
    // One primary action per step: Next. No Back before the script; Skip setup leaves onboarding.
    await expect(scriptStep.getByRole('link', { name: 'Back' })).toHaveCount(0);
    await expect(scriptStep.getByRole('link', { name: 'Skip setup' })).toHaveAttribute('href', `/app/projects/${projectId}`);
    await expect(scriptStep.locator('.bg-primary')).toHaveText(['Next']);
    for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`));
        await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
        await expectNoAxeViolations(page);
    }

    // Step 3: the installation check is the primary action; Next waits for nothing
    await scriptStep.getByRole('link', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${projectId}/install\\?onboarding=1&step=check$`));
    await expect(progress.locator('[aria-current="step"]')).toContainText('Step 3 of 4: Check installation');
    const checkStep = page.getByRole('region', { name: 'Check installation' });
    await expect(checkStep.locator('.bg-primary')).toHaveText(['Check installation']);
    await expectNoAxeViolations(page);
    // The progress links back to every step after the site
    await progress.getByRole('link', { name: 'Step 2 of 4: Add the script (done)' }).click();
    await expect(page.getByRole('region', { name: 'Add the script' })).toBeVisible();
    await progress.getByRole('link', { name: 'Step 4 of 4: Invite a reviewer' }).click();

    // Step 4: invite a reviewer, then Finish opens the comments
    await expect(page).toHaveURL(new RegExp(`/app/projects/${projectId}/install\\?onboarding=1&step=invite$`));
    const reviewerStep = page.getByRole('region', { name: 'Invite a reviewer' });
    await expect(reviewerStep).toContainText('Only people you invite can see and leave comments. They sign in with their email.');
    await expect(reviewerStep).toContainText('Once the script is on your site, accepting the invitation opens it with the toolbar.');
    await expect(reviewerStep).not.toContainText('Check availability in review setup');
    await expect(reviewerStep.locator('code')).toHaveCount(0);
    await expect(reviewerStep.getByRole('link', { name: 'Skip setup' })).toHaveCount(0);
    await expect(reviewerStep.getByRole('link', { name: 'Back' })).toHaveAttribute('href', `/app/projects/${projectId}/install?onboarding=1&step=check`);
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
    await reviewerStep.getByRole('link', { name: 'Finish' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${projectId}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'example.com' })).toBeVisible();
    await expect(page).toHaveTitle('example.com · uier');
    await expect(page.getByText('No comments yet')).toBeVisible();
    // Until the site sends a comment, the tabs offer the install guide; Settings is the header's cog
    await expect(page.getByRole('navigation', { name: 'Project' }).getByRole('link')).toHaveText(['Comments', 'Install']);
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('href', `/app/projects/${projectId}/settings`);
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

    // The install guide, in Settings → Installation, is the whole guide on one page, without the onboarding progress
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('navigation', { name: 'Project settings' }).getByRole('link', { name: 'Installation' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${projectId}/settings/installation$`));
    await expect(page.getByRole('heading', { name: 'Copy the script' })).toBeVisible();
    await expect(page.getByText(publicId)).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Check installation' })).toBeVisible();
    await expect(progress).toHaveCount(0);
    await expect(reviewerStep).toHaveCount(0);
    // Installation methods are keyboard accessible; checking the embed is script-specific. Until the
    // extension is in the store, its tab is one line and the setup guide.
    const scriptTab = page.getByRole('tab', { name: 'Install the script', exact: true });
    await scriptTab.focus(); await page.keyboard.press('ArrowRight');
    const extensionTab = page.getByRole('tab', { name: 'Use browser extension', exact: true });
    await expect(extensionTab).toBeFocused(); await page.keyboard.press('Enter');
    const extensionGuide = page.getByRole('region', { name: 'Browser extension setup' });
    await expect(extensionGuide).toContainText('The browser extension is not available yet. Use the script to review your site.');
    await expect(extensionGuide.locator('p, li')).toHaveCount(1);
    await expect(extensionGuide.getByRole('link', { name: 'Read the extension setup guide' })).toHaveAttribute('href', '/guides/browser-extension');
    await expect(page.getByRole('link', { name: 'Get the browser extension' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Check installation', exact: true })).toBeHidden();
    await expectNoAxeViolations(page);
    await extensionTab.focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Enter');
    await expect(scriptTab).toHaveAttribute('aria-selected', 'true');
    // The guide's old address (the toolbar links there) opens it too
    await page.goto(`/app/projects/${projectId}/install`);
    await expect(page).toHaveURL(new RegExp(`/app/projects/${projectId}/settings/installation$`));
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
    // Like the project header: who can comment under the name, and no address line
    const card = active.getByRole('listitem').filter({ hasText: 'Launch site' });
    await expect(card.locator('[data-slot="card-description"]')).toHaveText('Invited people');
    await expect(card).not.toContainText('done.example.com');
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

test('project settings sections save the name, comment access and addresses', async ({ page }) => {
    await signIn(page, uniqueEmail());
    const projectId = await createProject(page, { urls: ['settings.example.com'] });
    await page.goto(`/app/projects/${projectId}/settings`);
    await expect(page.getByRole('heading', { level: 1, name: 'settings.example.com' })).toBeVisible();
    // The header's Settings button is current (the breadcrumb ends at Settings too, as a disabled link)
    const settingsButton = page.getByRole('link', { name: 'Settings', exact: true, disabled: false });
    await expect(settingsButton).toHaveAttribute('aria-current', 'page');
    // An icon (the cog), named by its label and a tooltip
    await settingsButton.hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('Settings');
    await expect(page).toHaveTitle('Project settings · uier');
    // Every section has its own page; General is the settings page itself
    const sections = page.getByRole('navigation', { name: 'Project settings' });
    await expect(sections.getByRole('link')).toHaveText(['General', 'Review', 'Environments', 'Installation', 'People and teams', 'Integrations', 'Notifications', 'Danger zone']);
    await expect(sections.getByRole('link', { name: 'General' })).toHaveAttribute('aria-current', 'page');
    await expectNoAxeViolations(page);

    // Name and client, one save that waits for a change
    const general = page.getByRole('region', { name: 'General' });
    const saveGeneral = general.getByRole('button', { name: 'Save' });
    await expect(saveGeneral).toBeDisabled();
    await hydrated(general.locator('form'));
    await general.getByLabel('Project name').fill('Marketing site');
    await expect(general).toContainText('Unsaved changes');
    await general.getByRole('button', { name: 'Discard' }).click();
    await expect(general.getByLabel('Project name')).toHaveValue('settings.example.com');
    await expect(saveGeneral).toBeDisabled();
    await general.getByLabel('Project name').fill('Marketing site');
    await saveGeneral.click();
    await expect(general.getByRole('status')).toHaveText('Saved.');
    await expect(saveGeneral).toBeDisabled();

    // Who can comment, under Review
    await sections.getByRole('link', { name: 'Review' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${projectId}/settings/review$`));
    await expect(page).toHaveTitle('Review · Project settings · uier');
    await expect(sections.getByRole('link', { name: 'Review' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Review');
    const access = page.getByRole('region', { name: 'Review', exact: true });
    await expect(access.getByRole('radio', { name: 'Invited people' })).toBeChecked();
    // The page state is developer-level, under Advanced
    await expect(access.getByLabel('Meaningful query fields')).toBeHidden();
    await setProjectAccess(page, projectId, 'Anyone with the link');

    // Addresses with their labels, under Environments
    await sections.getByRole('link', { name: 'Environments' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${projectId}/settings/environments$`));
    const addresses = page.getByRole('region', { name: 'Site addresses' });
    await hydrated(addresses.locator('form'));
    await addresses.getByRole('button', { name: 'Add address' }).click();
    await expect(addresses.getByLabel('Address 2', { exact: true })).toBeFocused();
    await addresses.getByLabel('Address 2', { exact: true }).fill('localhost:3000/');
    await addresses.getByLabel('Label for localhost:3000/', { exact: true }).fill('Local');
    await addresses.getByRole('button', { name: 'Save' }).click();
    await expect(addresses.getByRole('status')).toHaveText('Saved.');
    await addresses.getByLabel('Address 2', { exact: true }).fill('not a site');
    await addresses.getByRole('button', { name: 'Save' }).click();
    await expect(addresses.getByRole('alert')).toContainText('"not a site" is not a website address.');
    // Save fades back in from its disabled look (transition-all); scan once it is opaque
    await expect(addresses.getByRole('button', { name: 'Save' })).toHaveCSS('opacity', '1');
    await expectNoAxeViolations(page);

    await page.reload();
    // Shown without the default scheme: HTTPS, or HTTP for a local address
    await expect(addresses.getByLabel('Main site address')).toHaveValue('settings.example.com');
    await expect(addresses.getByLabel('Address 2', { exact: true })).toHaveValue('localhost:3000');
    await expect(addresses.getByLabel('Label for localhost:3000', { exact: true })).toHaveValue('Local');
    await sections.getByRole('link', { name: 'Review' }).click();
    await expect(access.getByRole('radio', { name: 'Anyone with the link' })).toBeChecked();
    // The new name in the header and the breadcrumbs, and on the projects page
    await expect(page.getByRole('heading', { level: 1, name: 'Marketing site' })).toBeVisible();
    await page.goto('/app/projects');
    await expect(page.getByRole('list', { name: 'Active projects' }).getByRole('link', { name: 'Marketing site' })).toBeVisible();
});

test('the sidebar has the sections, the active projects and the account', async ({ page }) => {
    await signIn(page, uniqueEmail('sidebar'));
    const projectId = await createProject(page, { urls: ['sidebar.example.com'], name: 'Sidebar site' });

    const navigation = await appNavigation(page);
    await expect(navigation.getByRole('link', { name: 'Projects', exact: true })).toHaveAttribute('href', '/app/projects');
    await expect(navigation.getByRole('link', { name: 'Create project' })).toBeVisible();
    await expect(navigation.getByRole('link', { name: 'Workspace', exact: true })).toHaveAttribute('href', '/app/workspace/users');
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
    // A submenu opened while its menu is still zooming in closes again (Base UI); people are slower than that
    await animationsFinished(page.getByRole('menu'));
    await page.getByRole('menuitem', { name: 'Theme' }).click();
    await page.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
});

test('admins rename the workspace from its menu; commenters have no workspace settings', async ({ page }) => {
    const email = uniqueEmail('workspace-settings');
    await signIn(page, email);
    await createProject(page, { urls: ['workspace.example.com'], name: 'Workspace site' });

    // The workspace menu at the top of the sidebar opens the settings, a tab of the workspace area
    await appNavigation(page);
    await page.getByRole('button', { name: /^Workspace:/ }).click();
    await page.getByRole('menuitem', { name: 'Workspace settings' }).click();
    await expect(page).toHaveURL(/\/app\/workspace\/settings$/);
    await expect(page.getByRole('heading', { level: 1, name: email })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Workspace' }).getByRole('link')).toHaveText(['Users', 'Teams', 'Clients', 'Activity', 'Settings']);
    await expect(page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveTitle('Workspace settings · uier');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Settings');

    // A new workspace is named after its creator's email until an admin renames it
    const name = page.getByLabel('Workspace name');
    await expect(name).toHaveValue(email);
    await name.fill('  Acme   studio ');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'The workspace name is saved.' })).toBeVisible();
    await expectNoAxeViolations(page);

    // The sidebar and the area's header show the new name; the sidebar's Workspace opens the area
    const navigation = await appNavigation(page);
    await expect(navigation.getByRole('link', { name: 'Workspace', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Workspace:/ })).toContainText('Acme studio');
    await closeAppNavigation(page);
    await page.reload();
    await expect(page.getByLabel('Workspace name')).toHaveValue('Acme studio');

    // Everyone joins uier's workspace to send feedback on the app: the menu keeps it apart from their own
    // workspaces, under its own name. There it has no settings link, and the page is not there.
    await appNavigation(page);
    await page.getByRole('button', { name: /^Workspace:/ }).click();
    await expect(page.getByRole('menuitem', { name: /Acme studio.*Admin/ })).toHaveCount(0);
    await page.getByRole('menuitem', { name: /^Feedback on uier/ }).click();
    await expect(page).toHaveURL(/\/app\/projects$/);
    const commenterNavigation = await appNavigation(page);
    await expect(commenterNavigation.getByRole('link', { name: 'Workspace', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: /^Workspace:/ }).click();
    await expect(page.getByRole('menuitem', { name: /Acme studio.*Admin/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Workspace settings' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    // The old address of the settings goes to the area, which sends commenters to the projects
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
    await page.getByRole('menuitem', { name: /^Feedback on uier/ }).click();
    await expect(page.getByRole('list', { name: 'Active projects' }).getByRole('link', { name: 'uier.io public feedback' }))
        .toHaveAttribute('href', '/app/projects/uier00000001');
    await page.goto('/app/projects/uier00000001');
    // This local feedback has a loopback origin, outside the public project's production environment.
    await expect((await openCommentFilters(page)).getByRole('button', { name: /^Environment and page:/ })).toContainText('All environments and pages');
    await page.keyboard.press('Escape');
    await expect(await openComment(page, text)).toHaveAccessibleName('Comment by you');
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Email notifications', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Review', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Email content', exact: true })).toHaveCount(0);

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
    await expect(commentRowLink(staff.page, text)).toBeVisible();
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
    await hydrated(page.getByRole('region', { name: 'Profile' }).locator('form'));
    await page.getByLabel('Name').fill('Mia Reviewer');
    await expect(page.getByRole('region', { name: 'Profile' })).toContainText('Unsaved changes');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('region', { name: 'Profile' }).getByRole('status')).toHaveText('Your name is saved.');
    await appNavigation(page);
    await expect(page.getByRole('button', { name: 'Account: Mia Reviewer' })).toBeVisible();
    await closeAppNavigation(page);
    await expect(page).toHaveTitle('Account · uier');
    await expectNoAxeViolations(page);

    // The account's sections, like a project's settings: General is the account page itself
    const sections = page.getByRole('navigation', { name: 'Account' });
    await expect(sections.getByRole('link')).toHaveText(['General', 'Sign-in', 'Notifications', 'Coding agents']);
    // The workspace access leaves out what is not set: a new account has no relationship and no teams
    const workspaceAccess = page.getByRole('region', { name: 'Your workspace access' });
    await expect(workspaceAccess.locator('dt')).toHaveText(['Role', 'Projects']);
    await expect(workspaceAccess).not.toContainText('Unspecified');
    await expect(sections.getByRole('link', { name: 'General' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('region', { name: 'Sign out' })).toHaveCount(0);
    await sections.getByRole('link', { name: 'Sign-in' }).click();
    await expect(page).toHaveURL(/\/app\/account\/sign-in$/);
    await expect(page).toHaveTitle('Sign-in · Account · uier');
    await expect(sections.getByRole('link', { name: 'Sign-in' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('region', { name: 'Profile' })).toHaveCount(0);
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
    await page.goto(`/app/projects/${project}/settings/review`);
    const section = page.getByRole('region', { name: 'Review', exact: true });
    const input = section.getByLabel('Review brief');
    await expect(section).toContainText('Invited people read it in the toolbar.');
    await hydrated(section.locator('form'));
    await input.fill('  Review pricing.\nThen checkout.  ');
    const savedRequest = page.waitForRequest(request => request.method() === 'POST' && Boolean(request.headers()['next-action']));
    await section.getByRole('button', { name: 'Save' }).click();
    const actionRequest = await savedRequest;
    await expect(section.getByRole('status')).toContainText('Saved.');
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
        await expect(member.page.getByRole('region', { name: 'Review', exact: true })).toHaveCount(0);
        const response = await member.page.request.post(actionRequest.url(), {
            headers: { 'Next-Action': actionRequest.headers()['next-action']!, 'Content-Type': actionRequest.headers()['content-type']!, Origin: new URL(actionRequest.url()).origin },
            data: Buffer.from(actionRequest.postDataBuffer()!.toString().replace('Review pricing.', 'Changed by member.'))
        });
        expect(await response.text()).toContain('Only admins can do this.');
    } finally { await member.context.close(); }
    await page.goto(`/app/projects/${project}/settings/review`);
    await expect(input).toHaveValue('Review pricing.\nThen checkout.');
    await hydrated(section.locator('form'));
    // Clear the existing brief explicitly before exercising a whitespace-only submission.
    await input.clear();
    await input.fill(' \n ');
    await expect(input).toHaveValue(' \n ');
    await section.getByRole('button', { name: 'Save' }).click();
    await expect(section.getByRole('status')).toContainText('Saved.');
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
    // Rows in the list; a row opens its thread
    const row = (text: string) => commentRowLink(page, `${text} ${key}`);
    const open = (text: string) => openComment(page, `${text} ${key}`);
    await expect(row('Opened by target')).toBeVisible();
    await expect(row('Unrelated author')).toBeVisible();
    await (await open('Opened by target')).getByRole('button', { name: /^More actions/ }).click();
    await page.getByRole('menuitem', { name: 'More from this author', exact: true }).click();
    await expect(page).toHaveURL(/author=[A-Za-z0-9_-]{43}/);
    expect(page.url()).not.toContain('user:');
    await backToComments(page);
    await expect(row('Opened by target')).toBeVisible();
    await expect(row('Replied by target')).toBeVisible();
    await expect(row('Unrelated author')).toHaveCount(0);
    const authorQuery = new URL(page.url()).searchParams.get('author');
    await page.reload();
    await backToComments(page);
    await expect(row('Replied by target')).toBeVisible();
    const replyActions = (await open('Replied by target')).getByRole('button', { name: /^More actions for reply by/ });
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
    await backToComments(page);
    await expect(row('Replied by target')).toHaveCount(0); // No remaining participation by that author.
    await page.getByRole('button', { name: /^Clear author filter:/ }).click();
    await backToComments(page);
    await expect(row('Replied by target')).toBeVisible();
    await expect((await open('Replied by target')).getByText(`Target reply ${key}`)).toHaveCount(0);
    await backToComments(page);
    expect((await page.request.get(`/app/projects/uier00000001/comments/${opened.id}/screenshot`)).status()).toBe(200);
    await (await open('Opened by target')).getByRole('button', { name: /^More actions/ }).click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await backToComments(page);
    await expect(row('Opened by target')).toHaveCount(0);
    expect((await page.request.get(`/app/projects/uier00000001/comments/${opened.id}/screenshot`)).status()).toBe(404);
    expect((await guest.context.request.get(new URL(`/api/comments?path=/moderation-${key}`, page.url()).href)).ok()).toBe(true);
    const commenter = await newVisitor(browser, testInfo);
    try {
        await signIn(commenter.page, uniqueEmail('no-author-filter'), { from: new URL('/app/sign-in', page.url()).href });
        await appNavigation(commenter.page);
        await commenter.page.getByRole('button', { name: /^Workspace:/ }).click();
        await commenter.page.getByRole('menuitem', { name: /^Feedback on uier/ }).click();
        await expect(commenter.page.getByRole('list', { name: 'Active projects' }).getByRole('link', { name: 'uier.io public feedback', exact: true })).toBeVisible();
        await commenter.page.goto(new URL('/app/projects/uier00000001?environment=all', page.url()).href);
        const otherCard = await openComment(commenter.page, `Unrelated author ${key}`);
        await otherCard.getByRole('button', { name: /^More actions/ }).click();
        await expect(commenter.page.getByRole('menuitem', { name: 'More from this author', exact: true })).toHaveCount(0);
        await commenter.page.keyboard.press('Escape');
        await expect(commenter.page.getByRole('button', { name: /^Clear author filter:/ })).toHaveCount(0);
        expect((await commenter.context.request.get(new URL(`/app/projects/uier00000001?author=${authorQuery}`, page.url()).href)).status()).toBe(404);
    } finally { await commenter.context.close(); await guest.context.close(); await other.context.close(); }
});

test('reply from list and board with mentions, keyboard input and local drafts', { tag: ['@smoke', '@mobile-smoke'] }, async ({ page, request, baseURL }, testInfo) => {
    const { startReviewedSite } = await import('./support/reviewedSite');
    const { verifiedReviewHeaders } = await import('./support/reviewVerification');
    const site = await startReviewedSite(baseURL!);
    try {
        const email = uniqueEmail('app-reply');
        await signIn(page, email);
        const project = await createProject(page, { urls: [site.origin()] });
        await setProjectAccess(page, project, 'Anyone with the link');
        const headers = await verifiedReviewHeaders(request, project, site.origin());
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: '/removed-page', position: { type: 'point', selector: '#missing-anchor', xNormal: 0.5, yNormal: 0.5 }, text: 'Reply without finding a pin', authorName: 'Guest reviewer'
        } });
        expect(response.status()).toBe(201);
        const saved = await response.json();
        await page.goto(`/app/projects/${project}`);
        await expect(page.getByRole('textbox', { name: 'Reply', exact: true })).toHaveCount(0);
        // The open thread: beside the list, in its place on a phone, in a sheet on the board
        const card = await openComment(page, 'Reply without finding a pin');
        await card.getByRole('button', { name: 'Reply', exact: true }).click();
        const input = card.getByRole('textbox', { name: 'Reply', exact: true });
        await expect(input).toBeFocused();
        await input.fill('Keep this draft');
        await card.getByRole('button', { name: 'Close reply' }).click();
        await backToComments(page);
        await page.getByRole('button', { name: 'Board', exact: true }).click();
        await openComment(page, 'Reply without finding a pin');
        await card.getByRole('button', { name: 'Reply', exact: true }).click();
        await expect(input).toHaveValue('Keep this draft');
        await page.reload();
        await card.getByRole('button', { name: 'Reply', exact: true }).click();
        await expect(input).toHaveValue('Keep this draft');
        await card.getByRole('button', { name: 'Discard', exact: true }).click();
        await expect(input).toHaveValue('');
        await input.fill('Please check @');
        const people = card.getByRole('listbox', { name: 'Mention people' });
        await expect(people.getByRole('option')).toHaveCount(1);
        await input.press('Tab');
        await expect(input).toHaveValue(`Please check @${email.split('@')[0]} `);
        await input.press('Shift+Enter');
        await input.pressSequentially('Second line');
        const text = await input.inputValue();
        await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
        await expect(input).toHaveValue(text);
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        let posts = 0;
        await page.route(`**/app/projects/${project}*`, async route => {
            if (route.request().method() === 'POST' && route.request().headers()['next-action']) { posts++; await held; }
            await route.continue();
        });
        try {
            await input.press('Enter');
            await expect.poll(() => posts).toBe(1);
            await expect(card.getByText(text.trim(), { exact: true })).toBeVisible();
            await expect(input).toHaveValue('');
            await input.fill('New text while sending');
            await expect(card.getByRole('button', { name: 'Post reply' })).toBeDisabled();
            release();
            await expect(card.getByRole('button', { name: 'Post reply' })).toBeEnabled();
            await expect(input).toHaveValue('New text while sending');
            await expect(card.getByText(text.trim(), { exact: true })).toHaveCount(1);
        } finally { release(); }
        await page.unroute(`**/app/projects/${project}*`);
        const threads = await (await request.get(`/api/review/${project}/comments?scope=site`, { headers })).json();
        const thread = threads.find((item: { id: string }) => item.id === saved.id);
        expect(thread.thread.items).toHaveLength(2);
        // Replying is independent of status and read acknowledgement.
        await expect(card.getByRole('button', { name: 'Unread. Mark as read' })).toBeVisible();
        await card.getByRole('button', { name: 'Status: Open. Change status', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
        await expect(card.getByRole('button', { name: 'Status: Done. Change status' })).toBeEnabled();
        // The open thread keeps its reply box and draft through the status change
        await expect(input).toHaveValue('New text while sending');
        await input.fill('Reply on a done thread');
        await input.press('Enter');
        await expect(card.getByText('Reply on a done thread', { exact: true })).toBeVisible();
        await expect(card.getByRole('button', { name: 'Status: Done. Change status' })).toBeVisible();
        await expect(input).toHaveValue('');
        for (const colorScheme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme });
            await expect(page.locator('html')).toHaveClass(new RegExp(colorScheme));
            // Flush the new theme so its colour transitions have started before waiting for them
            await page.evaluate(() => getComputedStyle(document.body).color);
            await animationsFinished(page.locator('body'));
            await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
            await expectNoAxeViolations(page);
            await page.screenshot({ path: testInfo.outputPath(`app-reply-${colorScheme}.png`) });
        }
        await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); }; });
        await input.fill('Clear on sign-out');
        await expect(card.getByText('Browser storage is unavailable. Keep this page open to keep your draft.')).toBeVisible();
        await page.goto('/app/account/sign-in');
        await page.getByRole('region', { name: 'Sign out' }).getByRole('button', { name: 'Sign out' }).click();
        await expect(page).toHaveURL(/\/app\/sign-in$/);
        expect(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('uier:draft:') && key.includes('"app"')))).toEqual([]);
    } finally { await site.close(); }
});

test('app replies retry a lost response once and reject forged or unauthorized action arguments', async ({ page, request, browser, baseURL }) => {
    const { startReviewedSite } = await import('./support/reviewedSite');
    const { verifiedReviewHeaders } = await import('./support/reviewVerification');
    const site = await startReviewedSite(baseURL!);
    try {
        await signIn(page, uniqueEmail('app-retry'));
        const project = await createProject(page, { urls: [site.origin()] });
        await setProjectAccess(page, project, 'Anyone with the link');
        const headers = await verifiedReviewHeaders(request, project, site.origin());
        const saved = await (await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: '/old-page', position: { type: 'page' }, kind: 'feedback', text: 'Retry thread', authorName: 'Guest'
        } })).json();
        await page.goto(`/app/projects/${project}`);
        const card = await openComment(page, 'Retry thread');
        await card.getByRole('button', { name: 'Reply', exact: true }).click();
        const input = card.getByRole('textbox', { name: 'Reply', exact: true });
        await input.fill('Save once after response loss');
        let captured: import('@playwright/test').Request | undefined;
        let first = true;
        await page.route(`**/app/projects/${project}*`, async route => {
            if (first && route.request().method() === 'POST') {
                first = false; captured = route.request();
                expect((await route.fetch()).ok()).toBe(true);
                await route.abort('failed');
            } else await route.continue();
        });
        await input.press('Enter');
        await expect(card.getByRole('alert')).toBeVisible();
        await expect(input).toHaveValue('Save once after response loss');
        await page.reload();
        await card.getByRole('button', { name: 'Reply', exact: true }).click();
        await expect(input).toHaveValue('Save once after response loss');
        await input.press('Enter');
        await expect(input).toHaveValue('');
        await expect(card.getByText('Save once after response loss', { exact: true })).toHaveCount(1);
        await page.unroute(`**/app/projects/${project}*`);
        expect((await (await request.get(`/api/review/${project}/comments?scope=site`, { headers })).json()).find((item: { id: string }) => item.id === saved.id).thread.items).toHaveLength(2);
        const action = captured!;
        const post = (client: import('@playwright/test').APIRequestContext, input: unknown) => client.post(action.url(), {
            headers: { 'Next-Action': action.headers()['next-action']!, 'Content-Type': 'text/plain;charset=UTF-8', Origin: new URL(action.url()).origin }, maxRedirects: 0, data: JSON.stringify([input])
        });
        const valid = { projectId: project, commentId: saved.id, text: 'Forged reply', idempotencyKey: '0123456789abcdef' };
        const signedOut = await post(request, valid);
        expect(signedOut.status()).toBe(307);
        expect(signedOut.headers().location).toContain('/app/sign-in?next=');
        expect(await (await post(page.request, { ...valid, text: '' })).text()).toContain('Check the request and try again.');
        expect(await (await post(page.request, { ...valid, idempotencyKey: 'short' })).text()).toContain('Check the request and try again.');
        expect(await (await post(page.request, { ...valid, text: '@Missing', mentions: [{ userId: 'u_missing', start: 0, end: 8 }] })).text()).toContain('Choose someone who still has access');
        const other = await browser.newPage();
        try {
            await signIn(other, uniqueEmail('foreign-reply'));
            expect(await (await post(other.request, valid)).text()).toContain('This project no longer exists.');
        } finally { await other.close(); }
        await setProjectAccess(page, project, 'Comments off');
        expect(await (await post(page.request, valid)).text()).toContain('Comments are turned off');
        expect((await request.post(`/api/review/${project}/comments/${saved.id}/replies`, { headers, data: valid })).status()).toBe(403);
    } finally { await site.close(); }
});
