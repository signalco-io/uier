import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { appNavigation, closeAppNavigation, createProject, fillClientName, hydrated, signIn, uniqueEmail } from './support/app';
import { animationsFinished, newVisitor } from './support/toolbar';

test('clients show in the sidebar and on their page, and new projects pick an existing one', async ({ page }, testInfo) => {
    await signIn(page, uniqueEmail('clients-page'));
    await createProject(page, { urls: ['plain.example.com'], name: 'Plain site' });
    // The workspace area sits at the bottom of the navigation; its Clients tab is empty until a project has a client
    let navigation = await appNavigation(page);
    await expect(navigation.getByRole('link').last()).toHaveAccessibleName('Workspace');
    await closeAppNavigation(page);
    // The old address opens the Clients tab of the workspace area
    await page.goto('/app/clients');
    await expect(page).toHaveURL(/\/app\/workspace\/clients$/);
    await expect(page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'Clients' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('No clients yet', { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);

    await createProject(page, { urls: ['acme.example.com'], name: 'Acme site', clientName: 'Acme Studio' });

    // The same input suggests the existing clients and takes a new name
    await page.goto('/app/projects/new');
    const client = page.getByLabel('Client name (optional)');
    await client.click();
    await expect(page.getByRole('option', { name: 'Acme Studio', exact: true })).toBeVisible();
    await client.fill('Northwind');
    await expect(page.getByRole('option')).toHaveCount(0);
    await expect(page.getByText('New client', { exact: true })).toBeVisible();
    await client.fill('acm');
    await page.getByRole('option', { name: 'Acme Studio', exact: true }).click();
    await expect(client).toHaveValue('Acme Studio');
    await expect(page.getByRole('option')).toHaveCount(0);
    await expectNoAxeViolations(page);
    await page.getByLabel('Main site address').fill('shop.acme.example.com');
    await page.getByLabel('Project name').fill('Acme shop');
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.waitForURL(/\/app\/projects\/[0-9a-z]{12}\/install/);
    await expect(page.getByText('Client: Acme Studio', { exact: true })).toBeVisible();

    // A client with only done projects opens the done ones
    const doneId = await createProject(page, { urls: ['northwind.example.com'], name: 'Northwind site', clientName: 'Northwind' });
    await page.goto(`/app/projects/${doneId}/settings/danger-zone`);
    await page.getByRole('button', { name: 'Mark as done', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reopen project' })).toBeVisible();

    await page.goto('/app/clients');
    await expect(page).toHaveTitle('Clients · uier');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Clients');
    const clients = page.getByRole('list', { name: 'Clients' }).getByRole('listitem');
    await expect(clients).toHaveCount(2);
    await expect(clients.nth(0)).toContainText('Acme Studio');
    await expect(clients.nth(0)).toContainText('Acme shop, Acme site'); // Newest first, like the sidebar
    await expect(clients.nth(0)).toContainText('2 active');
    await expect(clients.nth(1)).toContainText('Northwind');
    await expect(clients.nth(1)).toContainText('1 done');
    await expectNoAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath('clients-light.png'), fullPage: true });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload(); // Scan settled dark colors, outside the theme's color transition.
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath('clients-dark.png'), fullPage: true });

    // Clients link to the projects list by their stable id, so a rename keeps the links working
    await clients.nth(1).getByRole('link').click();
    await expect(page).toHaveURL(url => url.pathname === '/app/projects'
        && url.searchParams.get('status') === 'done' && /^client_[\w-]{21}$/.test(url.searchParams.get('client') ?? ''));
    await expect(page.getByRole('list', { name: 'Done projects' }).getByRole('listitem')).toHaveCount(1);
    await page.goto('/app/clients');
    await clients.nth(0).getByRole('link').click();
    await expect(page).toHaveURL(url => /^client_[\w-]{21}$/.test(url.searchParams.get('client') ?? '') && !url.searchParams.has('status'));
    await expect(page.getByRole('list', { name: 'Active projects' }).getByRole('listitem')).toHaveCount(2);
    // Links from before clients had ids name the client; they open its id link
    const idLink = page.url();
    await page.goto('/app/projects?client=name%3AAcme%20Studio');
    await expect(page).toHaveURL(idLink);
    await expect(page.getByRole('combobox', { name: 'Client', exact: true })).toContainText('Acme Studio');
});

test('admins add a client on the Clients tab for the projects they choose', async ({ page }) => {
    await signIn(page, uniqueEmail('clients-add'));
    await createProject(page, { urls: ['shop.example.com'], name: 'Shop site' });
    await createProject(page, { urls: ['blog.example.com'], name: 'Blog site', clientName: 'Old client' });
    await createProject(page, { urls: ['docs.example.com'], name: 'Docs site' });
    await page.goto('/app/workspace/clients');
    await page.getByRole('button', { name: 'Add client' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAccessibleName('Add client');
    // Nothing to add until a project is chosen; a project with a client says which
    await expect(dialog.getByRole('button', { name: 'Add client' })).toBeDisabled();
    await expect(dialog.getByRole('checkbox', { name: /^Blog site Client: Old client$/ })).not.toBeChecked();
    await dialog.getByLabel('Client name').fill('Acme Studio');
    await dialog.getByRole('checkbox', { name: 'Shop site', exact: true }).click();
    await dialog.getByRole('checkbox', { name: /^Blog site/ }).click();
    await dialog.getByLabel('Description (optional)').fill('Retail sites.');
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Add client' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText('Acme Studio is added.')).toBeVisible();

    const clients = page.getByRole('list', { name: 'Clients' }).getByRole('listitem');
    await expect(clients).toHaveCount(1);
    await expect(clients).toContainText('Acme Studio');
    await expect(clients).toContainText('Retail sites.');
    await expect(clients).toContainText('Shop site');
    await expect(clients).toContainText('Blog site');

    // A name in use is refused in the dialog
    await page.getByRole('button', { name: 'Add client' }).click();
    await dialog.getByLabel('Client name').fill('acme studio');
    await dialog.getByRole('checkbox', { name: 'Docs site', exact: true }).click();
    await dialog.getByRole('button', { name: 'Add client' }).click();
    await expect(dialog.getByRole('alert')).toContainText('A client with this name already exists.');
});

test('admins rename a client and set its description, icon and colour; every project follows', async ({ page }, testInfo) => {
    await signIn(page, uniqueEmail('client-edit'));
    const first = await createProject(page, { urls: ['first.acme.example.com'], name: 'Acme first', clientName: 'Acme' });
    await createProject(page, { urls: ['second.acme.example.com'], name: 'Acme second', clientName: 'Acme' });
    await createProject(page, { urls: ['northwind-edit.example.com'], name: 'Northwind site', clientName: 'Northwind' });
    await page.goto('/app/projects');
    await page.getByRole('combobox', { name: 'Client', exact: true }).click();
    // Each client shows its mark beside its name, like the sidebar and the cards
    await expect(page.getByRole('option', { name: 'Acme', exact: true }).locator('[data-slot="client-mark"]')).toHaveText('A');
    await page.getByRole('option', { name: 'Acme', exact: true }).click();
    await expect(page).toHaveURL(url => /^client_[\w-]{21}$/.test(url.searchParams.get('client') ?? ''));
    const filtered = page.url();

    await page.goto('/app/clients');
    const clients = page.getByRole('list', { name: 'Clients' }).getByRole('listitem');
    await clients.nth(0).getByRole('button', { name: 'Edit Acme', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit client' });
    await expect(dialog.getByLabel('Client name')).toHaveValue('Acme');
    await expect(dialog.getByRole('button', { name: 'First letter' })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('button', { name: 'Ink' })).toHaveAttribute('aria-pressed', 'true');
    await animationsFinished(page.locator('body')); // Scan the opened dialog, not its fade-in
    await expectNoAxeViolations(page);

    // Another client's name is refused, and nothing changes
    await dialog.getByLabel('Client name').fill('Northwind');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Another client already uses this name.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(clients.nth(0)).toContainText('Acme');

    await clients.nth(0).getByRole('button', { name: 'Edit Acme', exact: true }).click();
    await expect(dialog.getByLabel('Client name')).toHaveValue('Acme');
    await dialog.getByLabel('Client name').fill('  Acme   Studio ');
    await dialog.getByLabel('Description (optional)').fill('Retail sites for the spring launch.');
    await dialog.getByRole('button', { name: 'Rocket' }).click();
    await dialog.getByRole('button', { name: 'Blue' }).click();
    await expect(dialog.getByRole('button', { name: 'Rocket' })).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: testInfo.outputPath('client-edit-light.png') });
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Acme Studio is saved.', { exact: true })).toBeVisible();
    await expect(clients.nth(0)).toContainText('Acme Studio');
    await expect(clients.nth(0)).toContainText('Retail sites for the spring launch.');
    await expect(clients.nth(0)).toContainText('Acme second, Acme first');
    await expect(clients.nth(0).locator('[data-slot="client-mark"] svg')).toBeVisible();
    await page.reload();
    await clients.nth(0).getByRole('button', { name: 'Edit Acme Studio', exact: true }).click();
    await expect(dialog.getByLabel('Client name')).toHaveValue('Acme Studio');
    await expect(dialog.getByRole('button', { name: 'Rocket' })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('button', { name: 'Blue' })).toHaveAttribute('aria-pressed', 'true');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload(); // Scan settled dark colors, outside the theme's color transition.
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath('clients-edited-dark.png'), fullPage: true });

    // Every project shows the new name, and the earlier filter link still opens the same client
    await page.goto(filtered);
    const active = page.getByRole('list', { name: 'Active projects' });
    await expect(active.getByRole('listitem')).toHaveCount(2);
    await expect(active.getByText('Client: Acme Studio', { exact: true })).toHaveCount(2);
    await expect(page.getByRole('combobox', { name: 'Client', exact: true })).toContainText('Acme Studio');
    await page.goto(`/app/projects/${first}/settings`);
    await expect(page.getByText('Client: Acme Studio', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'General', exact: true }).getByLabel('Client name (optional)')).toHaveValue('Acme Studio');
    await expectNoAxeViolations(page);
});

test('client names validate, normalize, persist in details and can be cleared', async ({ page }, testInfo) => {
    await signIn(page, uniqueEmail('client'));
    await page.getByLabel('Main site address').fill('clients.example.com');
    const input = page.getByLabel('Client name (optional)');
    await expect(input).toHaveAttribute('maxlength', '80');
    // Bypass the input limit to exercise server validation before creating anything.
    await input.evaluate(element => element.removeAttribute('maxlength'));
    await input.fill('x'.repeat(81));
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.locator('form').getByRole('alert')).toHaveText('Use at most 80 characters for the client name.');
    await expect(input).toHaveValue('x'.repeat(81));
    await input.fill('  North   & South  ');
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.waitForURL(/\/app\/projects\/[0-9a-z]{12}\/install\?onboarding=1$/);
    const projectId = page.url().split('/').at(-2)!;
    await page.goto(`/app/projects/${projectId}`);
    await expect(page.getByText('Client: North & South', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('Client: North & South', { exact: true })).toBeVisible();

    await page.goto(`/app/projects/${projectId}/settings`);
    const client = page.getByRole('region', { name: 'General', exact: true });
    await expect(client.getByLabel('Client name (optional)')).toHaveValue('North & South');
    await client.getByLabel('Client name (optional)').evaluate(element => element.removeAttribute('maxlength'));
    await hydrated(client.locator('form'));
    await fillClientName(client.getByLabel('Client name (optional)'), 'x'.repeat(81));
    await client.getByRole('button', { name: 'Save' }).click();
    await expect(client.getByRole('alert')).toHaveText('Use at most 80 characters for the client name.');
    await page.reload();
    await expect(client.getByLabel('Client name (optional)')).toHaveValue('North & South');
    await hydrated(client.locator('form'));
    await fillClientName(client.getByLabel('Client name (optional)'), 'A'.repeat(80));
    await client.getByRole('button', { name: 'Save' }).click();
    await expect(client.getByRole('status')).toHaveText('Saved.');
    await page.reload();
    await expect(client.getByLabel('Client name (optional)')).toHaveValue('A'.repeat(80));
    await hydrated(client.locator('form'));
    await fillClientName(client.getByLabel('Client name (optional)'), '  New   client  ');
    await client.getByRole('button', { name: 'Save' }).click();
    await expect(client.getByRole('status')).toHaveText('Saved.');
    await page.reload();
    await expect(client.getByLabel('Client name (optional)')).toHaveValue('New client');
    await expect(page.getByText('Client: New client', { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload(); // Scan settled dark colors, outside the theme's color transition.
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expectNoAxeViolations(page);
    await client.screenshot({ path: testInfo.outputPath('client-settings-dark.png') });

    await hydrated(client.locator('form'));
    await fillClientName(client.getByLabel('Client name (optional)'), '   ');
    await client.getByRole('button', { name: 'Save' }).click();
    await expect(client.getByRole('status')).toHaveText('Saved.');
    await page.reload();
    await expect(client.getByLabel('Client name (optional)')).toHaveValue('');
    await expect(page.getByText(/^Client: /)).toHaveCount(0);
    await page.goto('/app/projects?client=none');
    await expect(page.getByRole('list', { name: 'Active projects' }).getByRole('link', { name: 'clients.example.com' })).toBeVisible();
});

test('client filtering combines with status and survives reloads', async ({ page }, testInfo) => {
    await signIn(page, uniqueEmail('client-filter'));
    await createProject(page, { urls: ['active.example.com'], name: 'Active north', clientName: 'North & South' });
    const doneId = await createProject(page, { urls: ['done.example.com'], name: 'Done north', clientName: 'North & South' });
    await page.goto(`/app/projects/${doneId}/settings/danger-zone`);
    await page.getByRole('button', { name: 'Mark as done', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reopen project' })).toBeVisible();
    await createProject(page, { urls: ['another.example.com'], name: 'Another client', clientName: 'none' });
    await createProject(page, { urls: ['no-client.example.com'], name: 'No client site' });
    await page.goto('/app/projects');
    const filter = page.getByRole('combobox', { name: 'Client', exact: true });
    const chooseClient = async (name: string) => {
        await filter.click();
        await page.getByRole('option', { name, exact: true }).click();
        await expect(filter).toContainText(name);
        await expect(page).toHaveURL(url => {
            const client = url.searchParams.get('client');
            return name === 'All clients' ? client === null : name === 'No client' ? client === 'none' : /^client_[\w-]{21}$/.test(client ?? '');
        });
    };
    await chooseClient('North & South');
    const active = page.getByRole('list', { name: 'Active projects' });
    await expect(active.getByRole('listitem')).toHaveCount(1);
    await expect(active).toContainText('Active north');
    await expect(active).toContainText('Client: North & South');
    await expect(page.getByRole('link', { name: 'Active 1', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Done 1', exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath('client-filter-light.png'), fullPage: true });
    await page.getByRole('navigation', { name: 'Project status' }).getByRole('link', { name: /^Done/ }).click();
    await expect(page).toHaveURL(url => url.searchParams.get('status') === 'done');
    await page.reload();
    await expect(filter).toContainText('North & South');
    await expect(page.getByRole('list', { name: 'Done projects' })).toContainText('Done north');
    await chooseClient('No client');
    await expect(page.getByText('No done projects', { exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Project status' }).getByRole('link', { name: /^Done/ })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('navigation', { name: 'Project status' }).getByRole('link', { name: /^Active/ }).click();
    await expect(filter).toContainText('No client');
    await expect(active.getByRole('listitem')).toHaveCount(1);
    await expect(active).toContainText('No client site');
    await chooseClient('none'); // A client literally named "none" is distinct from No client.
    await page.reload();
    await expect(active.getByRole('listitem')).toHaveCount(1);
    await expect(active).toContainText('Another client');
    await chooseClient('All clients');
    await expect(active.getByRole('listitem')).toHaveCount(3);
    await expect(page).toHaveURL(/\/app\/projects$/);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload(); // Scan settled dark colors, outside the theme's color transition.
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath('client-filter-dark.png'), fullPage: true });
});

test('client names and updates stay in the current workspace and out of guest DTOs', async ({ page, browser }, testInfo) => {
    await signIn(page, uniqueEmail('client-owner'));
    const projectId = await createProject(page, { urls: ['private-client.example.com'], clientName: 'Private client' });
    const other = await newVisitor(browser, testInfo);
    await signIn(other.page, uniqueEmail('client-other'));
    const otherId = await createProject(other.page, { urls: ['other-client.example.com'], clientName: 'Other client' });
    await page.goto('/app/clients');
    const privateLink = await page.getByRole('link', { name: 'Private client', exact: true }).getAttribute('href');
    // Neither the old name link nor the id of another workspace's client filters or reveals it
    for (const link of ['/app/projects?client=name%3APrivate%20client', privateLink!]) {
        await other.page.goto(link);
        await expect(other.page.getByRole('combobox', { name: 'Client', exact: true })).toContainText('All clients');
        await expect(other.page.getByRole('list', { name: 'Active projects' }).getByRole('listitem')).toHaveCount(1);
    }
    await other.page.getByRole('combobox', { name: 'Client', exact: true }).click();
    await expect(other.page.getByRole('option', { name: 'Private client', exact: true })).toHaveCount(0);
    await expect(other.page.getByRole('option', { name: 'Other client', exact: true })).toBeVisible();
    await other.page.keyboard.press('Escape');
    expect((await other.page.request.get(`/app/projects/${projectId}`)).status()).toBe(404);
    await other.page.goto(`/app/projects/${otherId}/settings`);
    const client = other.page.getByRole('region', { name: 'General', exact: true });
    // An admin of a different workspace cannot use a known project id to update it.
    await client.locator('input[name="projectId"]').evaluate((element, id) => { (element as HTMLInputElement).value = id; }, projectId);
    await hydrated(client.locator('form'));
    await fillClientName(client.getByLabel('Client name (optional)'), 'Unauthorized change');
    await client.getByRole('button', { name: 'Save' }).click();
    await expect(client.getByRole('alert')).toHaveText('This project no longer exists.');
    await other.page.reload();
    await expect(client.getByLabel('Client name (optional)')).toHaveValue('Other client');
    await page.goto(`/app/projects/${projectId}`);
    await expect(page.getByText('Client: Private client', { exact: true })).toBeVisible();
    const response = await other.page.request.get(`/api/review/${projectId}`, { headers: { Origin: 'https://private-client.example.com' } });
    expect(response.status()).toBe(200);
    const reviewed = (await response.json()).project;
    expect(reviewed).not.toHaveProperty('clientName');
    expect(reviewed).not.toHaveProperty('clientId');
    expect(JSON.stringify(reviewed)).not.toContain('Private client');
    await other.context.close();
});

test('a project card keeps its favicon and actions at the top when the client and access row wraps', async ({ page }) => {
    await signIn(page, uniqueEmail('card-top'));
    await createProject(page, { urls: ['wrap.example.com'], name: 'Wrap site', clientName: 'A client with a long name that fills the row' });
    await page.goto('/app/projects');
    const card = page.getByRole('list', { name: 'Active projects' }).getByRole('listitem').filter({ hasText: 'Wrap site' });
    const title = card.locator('[data-slot="card-title"]');
    const description = card.locator('[data-slot="card-description"]');
    const favicon = card.locator('[data-slot="card-header"] > :first-child');
    const actions = card.getByRole('button', { name: 'More actions for Wrap site' });
    const review = card.getByRole('button', { name: 'Open review for Wrap site' });
    await expect(actions).toBeVisible();
    const [titleBox, descriptionBox, faviconBox, actionsBox, reviewBox] = await Promise.all(
        [title, description, favicon, actions, review].map((locator) => locator.boundingBox()));
    if (!titleBox || !descriptionBox || !faviconBox || !actionsBox || !reviewBox) throw new Error('The card header is not laid out');
    // The client, the access label and the open count wrap onto two lines
    expect(descriptionBox.height).toBeGreaterThan(titleBox.height * 1.5);
    // The favicon starts level with the name, not with the middle of the header
    expect(Math.abs(faviconBox.y - titleBox.y)).toBeLessThanOrEqual(2);
    // The icon buttons are centred on the name's line (they overhang it a little), not on the header
    const middle = (box: { y: number; height: number }) => box.y + box.height / 2;
    expect(Math.abs(middle(actionsBox) - middle(titleBox))).toBeLessThanOrEqual(2);
    expect(Math.abs(middle(reviewBox) - middle(titleBox))).toBeLessThanOrEqual(2);
});
