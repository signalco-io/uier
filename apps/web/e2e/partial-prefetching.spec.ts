import { expect, test, type Locator } from '@playwright/test';
import { instant } from '@next/playwright';
import { appNavigation, createProject, hydrated, signIn, uniqueEmail } from './support/app';

test('Security → Status keeps the public shell and streams live checks', async ({ page }) => {
    await page.goto('/security');
    const link = page.getByRole('link', { name: 'Status', exact: true });
    await link.scrollIntoViewIfNeeded();
    await hydrated(link);
    const section = page.getByRole('region', { name: 'Services' });
    const states = section.getByRole('listitem').locator('[data-state]');
    const sectionHeight = async () => (await section.boundingBox())?.height ?? Number.NaN;
    let shellHeight = Number.NaN;
    await instant(page, async () => {
        await link.click();
        await expect(page).toHaveURL(/\/status$/);
        await expect(page.getByRole('heading', { level: 1, name: 'Status', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'How this works', exact: true })).toBeVisible();
        await expect(page.getByRole('status').filter({ hasText: 'Checking services…' })).toBeVisible();
        // The shell has the service rows themselves: names and descriptions are real, each state says it is being checked
        await expect(section.getByText('Website', { exact: true })).toBeVisible();
        await expect(section.getByText('Comments', { exact: true })).toBeVisible();
        await expect(states).toHaveText(['Checking…', 'Checking…']);
        await expect(page.getByRole('status').filter({ hasText: 'Loading service checks…' })).toBeVisible();
        await expect(page.locator('time')).toHaveCount(0);
        shellHeight = await sectionHeight();
    });
    await expect(page.locator('time')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'All services are operational.' })).toBeVisible();
    await expect(states).toHaveText(['Operational', 'Operational']);
    // The results replace each row's state and fill the line under the panel: the section keeps its height
    expect(await sectionHeight()).toBeCloseTo(shellHeight, 0);
});

for (const populated of [false, true]) {
    test(`Projects → My work retains navigation; ${populated ? 'populated' : 'empty'} workspace`, async ({ page }) => {
        test.setTimeout(60_000);
        await signIn(page, uniqueEmail('partial'));
        if (populated) await createProject(page, { urls: ['https://partial.example.com'], name: 'Partial project' });
        // Observe the sidebar Link's own shell prefetch from Projects. Hydration alone can leave Next's
        // discovery and shell requests in flight when instant() takes the lock.
        const shellPrefetch = page.waitForResponse(response => {
            const headers = response.request().headers();
            return new URL(response.url()).pathname === '/app/my-work'
                && headers['next-url'] === '/app/projects'
                && headers['next-router-prefetch'] === '3'; // Next's RuntimeShell request
        });
        await page.goto('/app/projects');
        const navigation = await appNavigation(page);
        const link = navigation.getByRole('link', { name: 'My work', exact: true });
        await hydrated(link);
        const shell = await shellPrefetch;
        expect(shell.ok()).toBe(true);
        expect(await shell.finished()).toBeNull();
        await instant(page, async () => {
            await link.click();
            await expect(page).toHaveURL(/\/app\/my-work$/);
            // The existing layout remains useful while private, fresh page data waits.
            await expect(page.getByRole('button', { name: 'Toggle sidebar' }).last()).toBeVisible();
            // The title needs no data, so it is the page's shell; what needs the person waits behind the one status.
            // Search, Filter and List/Board exist only when something does, so they are not drawn yet
            await expect(page.getByRole('heading', { level: 1, name: 'My work', exact: true })).toBeVisible();
            await expect(page.getByRole('status', { name: 'Loading my work', exact: true })).toBeVisible();
            await expect(page.getByPlaceholder('Search feedback')).toHaveCount(0);
            await expect(page.getByText('Nothing needs you', { exact: true })).toHaveCount(0);
        });
        await expect(page.getByRole('heading', { level: 1, name: 'My work', exact: true })).toBeVisible();
        await expect(page.getByText('Nothing needs you', { exact: true })).toBeVisible();
        await expect(page.getByRole('status', { name: 'Loading my work', exact: true })).toHaveCount(0);
    });
}

test('My work → Projects draws its header, Create project and the status tabs while the lists load', async ({ page }) => {
    test.setTimeout(60_000);
    await signIn(page, uniqueEmail('partial-projects'));
    await createProject(page, { urls: ['https://partial-list.example.com'], name: 'Listed project', clientName: 'Listed client' });
    await page.goto('/app/my-work');
    const navigation = await appNavigation(page);
    const link = navigation.getByRole('link', { name: 'Projects', exact: true });
    await hydrated(link);
    const main = page.getByRole('main');
    const title = main.getByRole('heading', { level: 1, name: 'Projects', exact: true });
    const create = main.getByRole('link', { name: 'Create project', exact: true });
    const loadedTabs = main.getByRole('navigation', { name: 'Project status' });
    const clientFilter = main.getByRole('combobox', { name: 'Client', exact: true });
    const place = async (locator: Locator) => {
        const box = (await locator.boundingBox())!;
        return [box.x, box.y, box.width, box.height].map(Math.round);
    };
    let shell!: { title: number[]; create: number[]; tabs: number[] };
    await instant(page, async () => {
        await link.click();
        await expect(page).toHaveURL(/\/app\/projects$/);
        // What needs no data is real: the title, and Create project for an admin (the shell knows the role)
        await expect(title).toBeVisible();
        await expect(create).toBeVisible();
        // Active and Done are the page's own tabs, inert and out of the accessibility tree until its lists arrive, with
        // the address's tab current and the counts the sidebar already has
        const tabs = main.locator('[inert] nav');
        await expect(tabs.locator('a')).toHaveText([/^Active\s*1$/, /^Done\s*0$/]);
        await expect(tabs.locator('a[aria-current="page"]')).toHaveText(/^Active/);
        await expect(loadedTabs).toHaveCount(0);
        // The projects are the one thing loading. The client filter exists only when a project has a client, so it
        // comes with them
        await expect(page.getByRole('status', { name: 'Loading projects', exact: true })).toBeVisible();
        await expect(main.getByRole('list', { name: 'Active projects' })).toHaveCount(0);
        await expect(clientFilter).toHaveCount(0);
        shell = { title: await place(title), create: await place(create), tabs: await place(tabs) };
    });
    await expect(main.getByRole('list', { name: 'Active projects' }).getByRole('link', { name: 'Listed project', exact: true })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Loading projects', exact: true })).toHaveCount(0);
    await expect(loadedTabs.getByRole('link', { name: 'Active 1', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(clientFilter).toBeVisible();
    // Nothing moved when the lists arrived
    expect(await place(title)).toEqual(shell.title);
    expect(await place(create)).toEqual(shell.create);
    expect(await place(loadedTabs)).toEqual(shell.tabs);
});
