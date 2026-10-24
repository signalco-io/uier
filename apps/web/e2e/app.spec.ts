import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, signIn, uniqueEmail } from './support/app';

// The signed-in app (issue #34): sign-in, onboarding, projects, project settings and billing.

test('signed-out visitors are sent to sign in and come back afterwards', async ({ page }) => {
    await page.goto('/app/billing');
    await expect(page).toHaveURL(/\/app\/sign-in\?next=%2Fapp%2Fbilling$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expect(page).toHaveTitle('Sign in · uier');
    await expectNoAxeViolations(page);

    await signIn(page, uniqueEmail(), { from: page.url() });
    await expect(page).toHaveURL(/\/app\/billing$/);
});

test('a sign-in link works once', async ({ page, browser }) => {
    const email = uniqueEmail();
    await page.goto('/app/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
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

test('the sign-in form validates the address', async ({ page }) => {
    await page.goto('/app/sign-in');
    await page.getByLabel('Email').fill('not an email');
    // Bypass the browser's own type="email" check to reach the server validation
    await page.locator('form').evaluate(form => form.setAttribute('novalidate', ''));
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.locator('form').getByRole('alert')).toHaveText('Enter a valid email address.');
    await expect(page.getByLabel('Email')).toHaveValue('not an email');
});

test('onboarding creates a project with its addresses and shows the install guide', async ({ page }) => {
    await signIn(page, uniqueEmail());
    // A new user without projects starts onboarding
    await expect(page).toHaveURL(/\/app\/projects\/new$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Create a project' })).toBeVisible();
    await expect(page).toHaveTitle('Create project · uier');
    await expectNoAxeViolations(page);

    const projectId = await createProject(page, { urls: ['www.example.com/', 'https://staging.example.com/app/'] });

    // Install guide: the script with the project code, platform guidance and the CSP sources
    await expect(page.getByRole('heading', { level: 1, name: 'Install uier on example.com' })).toBeVisible();
    await expect(page.getByText(`data-uier-project="${projectId}"`).first()).toBeVisible();
    await expect(page.getByText('/toolbar.js" data-uier-project=').first()).toContainText('defer></script>');
    await expect(page.getByText(/Paste it before the closing <\/body> tag/)).toBeVisible();
    for (const platform of ['HTML', 'Next.js', 'React', 'WordPress', 'Webflow', 'Shopify'])
        await expect(page.getByRole('tab', { name: platform })).toBeVisible();
    await page.getByRole('tab', { name: 'Next.js' }).click();
    await expect(page.getByText('strategy="afterInteractive"')).toBeVisible();
    await page.getByText('Advanced: security headers').click();
    await expect(page.getByText('connect-src http://')).toBeVisible();
    await expect(page.getByText('style-src \'unsafe-inline\' https://fonts.googleapis.com')).toBeVisible();
    // Metadata is streamed after the content
    await expect(page).toHaveTitle('Install · uier');
    await expectNoAxeViolations(page);

    // The project, with both addresses normalized
    await page.getByRole('link', { name: 'Go to the project' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${projectId}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'example.com' })).toBeVisible();
    await expect(page).toHaveTitle('example.com · uier');
    await page.getByRole('button', { name: 'Open review' }).click();
    await expect(page.getByRole('menuitem', { name: /www\.example\.com\s*Main site/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /staging\.example\.com\/app/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expectNoAxeViolations(page);
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

    expect(await location('')).toBe(`https://example.com/?toolbar-code=${projectId}`);
    expect(await location(`?url=${encodeURIComponent('https://staging.example.com/pricing?plan=1')}`))
        .toBe(`https://staging.example.com/pricing?plan=1&toolbar-code=${projectId}`);
    expect(await location('?comment=comment_abc123'))
        .toBe(`https://example.com/?toolbar-code=${projectId}&uier-comment=comment_abc123`);
    // Another site is never a redirect target
    expect(await location(`?url=${encodeURIComponent('https://evil.example.net/')}`)).toBe(`https://example.com/?toolbar-code=${projectId}`);

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
    await expect(page.getByText('No active projects.')).toBeVisible();

    await page.getByRole('link', { name: /^Done/ }).click();
    const done = page.getByRole('list', { name: 'Done projects' });
    await expect(done.getByRole('link', { name: 'Launch site' })).toBeVisible();

    // The saved state, after a reload
    await page.reload();
    await done.getByRole('button', { name: 'More actions for Launch site' }).click();
    await page.getByRole('menuitem', { name: 'Reopen' }).click();
    await expect(page.getByText('No done projects.')).toBeVisible();
    await page.getByRole('link', { name: /^Active/ }).click();
    await expect(page.getByRole('list', { name: 'Active projects' }).getByRole('link', { name: 'Launch site' })).toBeVisible();
});

test('project settings save the comment access, addresses and name', async ({ page }) => {
    await signIn(page, uniqueEmail());
    const projectId = await createProject(page, { urls: ['settings.example.com'] });
    await page.goto(`/app/projects/${projectId}/settings`);
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(page).toHaveTitle('Project settings · uier');
    await expectNoAxeViolations(page);

    // Who can comment
    const access = page.getByRole('region', { name: 'Comments' });
    await expect(access.getByRole('combobox')).toContainText('Invited people');
    await access.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Anyone with the link' }).click();
    await access.getByRole('button', { name: 'Save' }).click();
    await expect(access.getByRole('status')).toContainText('Saved.');

    // Addresses
    const addresses = page.getByRole('region', { name: 'Site addresses' });
    await addresses.getByRole('button', { name: 'Add another address' }).click();
    await addresses.getByLabel('Other address').fill('localhost:3000/');
    await addresses.getByRole('button', { name: 'Save' }).click();
    await expect(addresses.getByRole('status')).toHaveText('The addresses are saved.');
    await addresses.getByLabel('Other address').fill('not a site');
    await addresses.getByRole('button', { name: 'Save' }).click();
    await expect(addresses.getByRole('alert')).toContainText('"not a site" is not a website address.');

    // Name
    const general = page.getByRole('region', { name: 'General' });
    await general.getByLabel('Project name').fill('Marketing site');
    await general.getByRole('button', { name: 'Save' }).click();
    await expect(general.getByRole('status')).toHaveText('The name is saved.');

    // Project code and embed script
    const install = page.getByRole('region', { name: 'Install' });
    await expect(install.getByText(projectId, { exact: true })).toBeVisible();
    await expect(install.getByText(`data-uier-project="${projectId}"`)).toBeVisible();

    await page.reload();
    await expect(access.getByRole('combobox')).toContainText('Anyone with the link');
    await expect(addresses.getByLabel('Main site address')).toHaveValue('https://settings.example.com');
    await expect(addresses.getByLabel('Other address')).toHaveValue('https://localhost:3000');
    await page.goto('/app/projects');
    await expect(page.getByRole('link', { name: 'Marketing site' })).toBeVisible();
});

test('billing says every feature is free, for good', async ({ page }) => {
    await signIn(page, uniqueEmail());
    await page.goto('/app/billing');
    await expect(page.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible();
    await expect(page.getByText('Every feature available today is free and will stay free forever. If we introduce pricing, it will apply only to new features users want.')).toBeVisible();
    await expect(page.getByText('There is no payment method to add, nothing to upgrade and nothing to cancel.')).toBeVisible();
    await expect(page).toHaveTitle('Billing · uier');
    await expectNoAxeViolations(page);
});

test('the account page saves the name and signs out', async ({ page }) => {
    await signIn(page, uniqueEmail('account'));
    await page.goto('/app/account');
    await expect(page.getByLabel('Name')).toHaveValue(/^account-/);
    await page.getByLabel('Name').fill('Mia Reviewer');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status')).toHaveText('Your name is saved.');
    await expect(page.getByRole('button', { name: 'Account: Mia Reviewer' })).toBeVisible();
    await expect(page).toHaveTitle('Account · uier');
    await expectNoAxeViolations(page);

    await page.getByRole('region', { name: 'Sign out' }).getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/app\/sign-in$/);
    await page.goto('/app/projects');
    await expect(page).toHaveURL(/\/app\/sign-in\?next=/);
});
