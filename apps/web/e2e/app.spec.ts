import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { appNavigation, closeAppNavigation, createProject, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { newVisitor, toolbar } from './support/toolbar';

// The signed-in app (issue #34): sign-in, onboarding, the sidebar, projects, project settings and the account.

test('signed-out visitors are sent to sign in and come back afterwards', async ({ page }) => {
    await page.goto('/app/account');
    await expect(page).toHaveURL(/\/app\/sign-in\?next=%2Fapp%2Faccount$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expect(page).toHaveTitle('Sign in · uier');
    await expectNoAxeViolations(page);

    await signIn(page, uniqueEmail(), { from: page.url() });
    await expect(page).toHaveURL(/\/app\/account$/);
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

    // Install guide (the project's Install tab): the script with the project code, platform guidance and the CSP sources
    await expect(page.getByRole('heading', { level: 1, name: 'example.com' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Project' }).getByRole('link', { name: 'Install' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText(projectId, { exact: true })).toBeVisible();
    await expect(page.getByText(`data-uier-project="${projectId}"`).first()).toBeVisible();
    await expect(page.getByText('/toolbar.js" data-uier-project=').first()).toContainText('defer></script>');
    await expect(page.getByText(/Paste it before the closing <\/body> tag/)).toBeVisible();
    for (const platform of ['HTML', 'Next.js', 'React', 'WordPress', 'Webflow', 'Shopify'])
        await expect(page.getByRole('tab', { name: platform })).toBeVisible();
    await page.getByRole('tab', { name: 'Next.js' }).click();
    await expect(page.getByText('strategy="afterInteractive"')).toBeVisible();
    await page.getByText('Advanced: security headers').click();
    await expect(page.getByText(/in proxy\.ts \(middleware\.ts before Next\.js 16\)/)).toBeVisible();
    await expect(page.getByText('connect-src http://')).toBeVisible();
    await expect(page.getByText('style-src \'unsafe-inline\' https://fonts.googleapis.com')).toBeVisible();
    // Metadata is streamed after the content
    await expect(page).toHaveTitle('Install · uier');
    await expectNoAxeViolations(page);

    // The project, with both addresses normalized
    await page.getByRole('link', { name: 'Go to the comments' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${projectId}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'example.com' })).toBeVisible();
    await expect(page).toHaveTitle('example.com · uier');
    await expect(page.getByText('No comments yet')).toBeVisible();
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
    // A missing comment has no known original source and must not be retargeted to the main site.
    const missing = await request.get(`/app/review/${projectId}?comment=comment_abc123`, { maxRedirects: 0 });
    expect(missing.status()).toBe(404);
    expect(await missing.text()).toContain('original site address may have been removed');
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
    await expect(page.getByRole('navigation', { name: 'Project' }).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveTitle('Project settings · uier');
    await expectNoAxeViolations(page);

    // Who can comment
    const access = page.getByRole('region', { name: 'Who can comment' });
    await expect(access.getByRole('radio', { name: 'Invited people' })).toBeChecked();
    await setProjectAccess(page, projectId, 'Anyone with the link');

    // Addresses
    const addresses = page.getByRole('region', { name: 'Site addresses' });
    await addresses.getByRole('button', { name: 'Add another address' }).click();
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
    await expect(addresses.getByLabel('Address 2', { exact: true })).toHaveValue('https://localhost:3000');
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
    await dialog.getByRole('textbox', { name: 'Feedback' }).fill(text);
    await dialog.getByRole('button', { name: 'Send feedback' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Feedback sent' })).toBeAttached();
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
    await expect(page.getByRole('article', { name: 'Comment by you' }).filter({ hasText: text })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);

    const second = await newVisitor(browser, testInfo);
    await signIn(second.page, uniqueEmail('feedback-other'), { from: new URL('/app/sign-in', page.url()).href });
    expect(texts(await (await second.context.request.get(pageComments)).json())).not.toContain(text);
    await second.context.close();

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
    await expect(page.getByRole('status')).toHaveText('Your name is saved.');
    await appNavigation(page);
    await expect(page.getByRole('button', { name: 'Account: Mia Reviewer' })).toBeVisible();
    await closeAppNavigation(page);
    await expect(page).toHaveTitle('Account · uier');
    await expectNoAxeViolations(page);

    await page.getByRole('region', { name: 'Sign out' }).getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/app\/sign-in$/);
    await page.goto('/app/projects');
    await expect(page).toHaveURL(/\/app\/sign-in\?next=/);
});
