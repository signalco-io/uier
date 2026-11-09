import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { appNavigation, createProject, hydrated, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished } from './support/toolbar';

// The sidebar's projects (uier #32): sorted and grouped (Sort and Group, uier #49), remembered.

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

/** The sidebar's project links in order (not Create project); each name ends the link's text, after its tile's letter */
const projectLinks = (page: Page) => page.getByRole('navigation', { name: 'App' }).locator('a[href^="/app/projects/"]:not([href="/app/projects/new"])');
const inOrder = (...names: string[]) => names.map(name => new RegExp(`${name}$`));

/** Opens the Sort and Group menu (from the keyboard, so the menu and its trigger stay reachable without a pointer) */
async function openOrderMenu(page: Page) {
    const navigation = await appNavigation(page);
    const trigger = navigation.getByRole('button', { name: 'Sort and group projects' });
    await hydrated(trigger);
    // On phones the pointer stays where Toggle sidebar was tapped, over the workspace switcher in the sheet:
    // rest it on the plain label (on the trigger, its tooltip would take the next Escape)
    await navigation.getByText(/^(Active|All) projects$/).hover();
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await animationsFinished(menu);
    return menu;
}

/** A choice in the menu's Sort or Group section */
const option = (menu: Locator, section: 'Sort' | 'Group', name: string) =>
    menu.getByRole('group', { name: section }).getByRole('menuitemradio', { name, exact: true });

/** Closes the menu; focus goes back to its trigger */
async function closeOrderMenu(page: Page, menu: Locator) {
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
}

/** The saved choice (the local HTTP name of `__Host-uier_project_order`) */
async function savedOrder(page: Page) {
    return (await page.context().cookies()).find(cookie => cookie.name === 'uier_project_order')?.value;
}

/** Marks a project done from its settings, so the projects page and its card actions stay out of the way */
async function markDone(page: Page, projectId: string) {
    await page.goto(`/app/projects/${projectId}/settings/danger-zone`);
    await page.getByRole('button', { name: 'Mark as done', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reopen project' })).toBeVisible();
}

test('the sidebar sorts the active projects by recent activity, creation or name, groups them by client and remembers it', async ({ page, request }) => {
    await signIn(page, uniqueEmail('project-order'));
    // Oldest first: Charlie gets a comment later, which makes it the most recent
    const charlie = await createProject(page, { urls: [site.origin()], name: 'Charlie', clientName: 'Zeta Co' });
    await createProject(page, { urls: ['alpha.example.com'], name: 'Alpha' });
    await createProject(page, { urls: ['delta.example.com'], name: 'Delta', clientName: 'Acme' });
    await createProject(page, { urls: ['bravo.example.com'], name: 'Bravo', clientName: 'Zeta Co' });

    // Recent activity is the default: a project without comments counts from its creation
    await page.goto('/app/projects');
    await appNavigation(page);
    await expect(projectLinks(page)).toHaveText(inOrder('Bravo', 'Delta', 'Alpha', 'Charlie'));

    // New feedback moves its project to the top
    await setProjectAccess(page, charlie, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, charlie, site.origin());
    const response = await request.post(`/api/review/${charlie}/comments`, { headers, data: {
        path: `/${charlie}/pricing`, text: 'The price table overlaps the footer', authorName: 'Guest', position: { type: 'page' }, kind: 'feedback'
    } });
    expect(response.status()).toBe(201);
    await page.goto('/app/projects');
    await appNavigation(page);
    await expect(projectLinks(page)).toHaveText(inOrder('Charlie', 'Bravo', 'Delta', 'Alpha'));

    // Two labelled sections, one choice in each
    let menu = await openOrderMenu(page);
    await expect(menu.getByRole('group', { name: 'Sort' }).getByRole('menuitemradio')).toHaveText(['Recent activity', 'Recently created', 'Name']);
    await expect(menu.getByRole('group', { name: 'Group' }).getByRole('menuitemradio')).toHaveText(['None', 'Client', 'Status']);
    await expect(option(menu, 'Sort', 'Recent activity')).toHaveAttribute('aria-checked', 'true');
    await expect(option(menu, 'Group', 'None')).toHaveAttribute('aria-checked', 'true');
    await expectNoAxeViolations(page);

    // Recently created, chosen with the keyboard: newest first, whatever the activity
    await page.keyboard.press('ArrowDown');
    await expect(option(menu, 'Sort', 'Recently created')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(option(menu, 'Sort', 'Recently created')).toHaveAttribute('aria-checked', 'true');
    await expect(option(menu, 'Sort', 'Recent activity')).toHaveAttribute('aria-checked', 'false');
    await expect(projectLinks(page)).toHaveText(inOrder('Bravo', 'Delta', 'Alpha', 'Charlie'));
    await expect.poll(() => savedOrder(page)).toBe('created');

    // Name; the menu stays open for the grouping
    await page.keyboard.press('ArrowDown');
    await expect(option(menu, 'Sort', 'Name')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(option(menu, 'Sort', 'Name')).toHaveAttribute('aria-checked', 'true');
    await expect(projectLinks(page)).toHaveText(inOrder('Alpha', 'Bravo', 'Charlie', 'Delta'));

    // Grouped by client: clients by name, each client's projects a list named by the client, the rest last
    await option(menu, 'Group', 'Client').click();
    await expect(option(menu, 'Group', 'Client')).toHaveAttribute('aria-checked', 'true');
    await expect(option(menu, 'Group', 'None')).toHaveAttribute('aria-checked', 'false');
    await closeOrderMenu(page, menu);
    const navigation = page.getByRole('navigation', { name: 'App' });
    await expect(projectLinks(page)).toHaveText(inOrder('Delta', 'Bravo', 'Charlie', 'Alpha'));
    await expect(navigation.getByRole('list', { name: 'Zeta Co' }).getByRole('link')).toHaveText(inOrder('Bravo', 'Charlie'));
    await expect(navigation.getByRole('list', { name: 'No client' }).getByRole('link')).toHaveText(inOrder('Alpha'));
    // Focus is back on the trigger, whose tooltip fades in: scan its settled colours
    await animationsFinished(page.locator('body'));
    await expectNoAxeViolations(page);
    await expect.poll(() => savedOrder(page)).toBe('alphabetical.client');

    // Remembered after a reload: the server renders the saved order
    await page.reload();
    await appNavigation(page);
    await expect(projectLinks(page)).toHaveText(inOrder('Delta', 'Bravo', 'Charlie', 'Alpha'));

    // Recent activity, still grouped: the client with the latest activity first
    menu = await openOrderMenu(page);
    await expect(option(menu, 'Sort', 'Name')).toHaveAttribute('aria-checked', 'true');
    await expect(option(menu, 'Group', 'Client')).toHaveAttribute('aria-checked', 'true');
    await option(menu, 'Sort', 'Recent activity').click();
    await closeOrderMenu(page, menu);
    await expect(projectLinks(page)).toHaveText(inOrder('Charlie', 'Bravo', 'Delta', 'Alpha'));
    await expect(navigation.getByRole('list', { name: 'Zeta Co' }).getByRole('link')).toHaveText(inOrder('Charlie', 'Bravo'));
    await expect.poll(() => savedOrder(page)).toBe('recent.client');

    // Recently created, still grouped: the client of the newest project first
    menu = await openOrderMenu(page);
    await option(menu, 'Sort', 'Recently created').click();
    await closeOrderMenu(page, menu);
    await expect(projectLinks(page)).toHaveText(inOrder('Bravo', 'Charlie', 'Delta', 'Alpha'));
    await expect(navigation.getByRole('list', { name: 'Acme' }).getByRole('link')).toHaveText(inOrder('Delta'));
    await expect.poll(() => savedOrder(page)).toBe('created.client');
});

test('grouped by status, the sidebar lists the done projects too, under Active and Done', async ({ page }) => {
    await signIn(page, uniqueEmail('project-status-group'));
    await createProject(page, { urls: ['alpha.example.com'], name: 'Alpha' });
    const bravo = await createProject(page, { urls: ['bravo.example.com'], name: 'Bravo' });
    await createProject(page, { urls: ['charlie.example.com'], name: 'Charlie' });
    const delta = await createProject(page, { urls: ['delta.example.com'], name: 'Delta' });
    await markDone(page, bravo);
    await markDone(page, delta);

    // Not grouped: only the active projects
    await page.goto('/app/projects');
    const navigation = await appNavigation(page);
    await expect(navigation.getByText('Active projects', { exact: true })).toBeVisible();
    await expect(projectLinks(page)).toHaveText(inOrder('Charlie', 'Alpha'));

    // Without clients there is nothing to group by client
    let menu = await openOrderMenu(page);
    await expect(menu.getByRole('group', { name: 'Group' }).getByRole('menuitemradio')).toHaveText(['None', 'Status']);
    await option(menu, 'Group', 'Status').click();
    await expect(option(menu, 'Group', 'Status')).toHaveAttribute('aria-checked', 'true');
    await closeOrderMenu(page, menu);
    // Every project, each status a list named by it: Active first, then Done
    await expect(navigation.getByText('All projects', { exact: true })).toBeVisible();
    await expect(projectLinks(page)).toHaveText(inOrder('Charlie', 'Alpha', 'Delta', 'Bravo'));
    await expect(navigation.getByRole('list', { name: 'Active' }).getByRole('link')).toHaveText(inOrder('Charlie', 'Alpha'));
    await expect(navigation.getByRole('list', { name: 'Done' }).getByRole('link')).toHaveText(inOrder('Delta', 'Bravo'));
    await animationsFinished(page.locator('body'));
    await expectNoAxeViolations(page);
    await expect.poll(() => savedOrder(page)).toBe('recent.status');

    // Sorted by name within each status
    menu = await openOrderMenu(page);
    await option(menu, 'Sort', 'Name').click();
    await closeOrderMenu(page, menu);
    await expect(navigation.getByRole('list', { name: 'Active' }).getByRole('link')).toHaveText(inOrder('Alpha', 'Charlie'));
    await expect(navigation.getByRole('list', { name: 'Done' }).getByRole('link')).toHaveText(inOrder('Bravo', 'Delta'));
    await expect.poll(() => savedOrder(page)).toBe('alphabetical.status');

    // Remembered after a reload; a done project's page is current in its own entry
    await page.goto(`/app/projects/${delta}`);
    const reloaded = await appNavigation(page);
    await expect(reloaded.getByRole('list', { name: 'Done' }).getByRole('link')).toHaveText(inOrder('Bravo', 'Delta'));
    await expect(reloaded.getByRole('list', { name: 'Done' }).getByRole('link', { name: 'Delta' })).toHaveAttribute('aria-current', 'page');
    await expect(reloaded.getByRole('link', { name: 'Projects', exact: true })).not.toHaveAttribute('aria-current', 'page');

    // Not grouped again: the done projects leave the list
    menu = await openOrderMenu(page);
    await expect(option(menu, 'Sort', 'Name')).toHaveAttribute('aria-checked', 'true');
    await expect(option(menu, 'Group', 'Status')).toHaveAttribute('aria-checked', 'true');
    await option(menu, 'Group', 'None').click();
    await closeOrderMenu(page, menu);
    await expect(navigation.getByText('Active projects', { exact: true })).toBeVisible();
    await expect(projectLinks(page)).toHaveText(inOrder('Alpha', 'Charlie'));
    await expect.poll(() => savedOrder(page)).toBe('alphabetical');
});

test('an order saved before Sort and Group reads as the same choice', async ({ page, baseURL }) => {
    await signIn(page, uniqueEmail('project-order-saved'));
    await createProject(page, { urls: ['alpha.example.com'], name: 'Alpha' });
    await createProject(page, { urls: ['bravo.example.com'], name: 'Bravo', clientName: 'Acme' });
    // Alphabetical, with Group by client checked
    await page.context().addCookies([{ name: 'uier_project_order', value: 'alphabetical.client', url: baseURL! }]);

    await page.goto('/app/projects');
    const navigation = await appNavigation(page);
    await expect(navigation.getByRole('list', { name: 'Acme' }).getByRole('link')).toHaveText(inOrder('Bravo'));
    await expect(navigation.getByRole('list', { name: 'No client' }).getByRole('link')).toHaveText(inOrder('Alpha'));
    const menu = await openOrderMenu(page);
    await expect(option(menu, 'Sort', 'Name')).toHaveAttribute('aria-checked', 'true');
    await expect(option(menu, 'Group', 'Client')).toHaveAttribute('aria-checked', 'true');
});

/** Where a sidebar link's parts are: its leading icon (a page's icon, a project's tile) and its label */
function linkParts(link: Locator) {
    return link.evaluate(element => {
        const box = (node: Element | null) => {
            if (!node) throw new Error('Missing part');
            const { x, y, width, height } = node.getBoundingClientRect();
            return { x, y, width, height, centerX: x + width / 2, centerY: y + height / 2 };
        };
        return {
            link: box(element),
            icon: box(element.querySelector(':scope > svg, :scope > span[aria-hidden="true"]')),
            label: box(element.querySelector(':scope > span:last-child'))
        };
    });
}

// uier #44: project tiles sit in the column of the page icons; uier #87: the favicon keeps the mark's padding inside the tile
test('the sidebar shows project favicons padded inside their tiles with names in line with the pages above', async ({ page, isMobile }) => {
    // uier #47: uier's server finds the icon (e2e/support/siteIconsStub.ts): icon.example.com redirects to a
    // sign-in page that declares an SVG at its own path and has no /favicon.ico; letter.example.com has no icon.
    // The browser never contacts the sites.
    const siteRequests: string[] = [];
    page.on('request', request => { if (/(^|\.)example\.com$/.test(new URL(request.url()).hostname)) siteRequests.push(request.url()); });
    await signIn(page, uniqueEmail('project-icons'));
    await createProject(page, { urls: ['icon.example.com'], name: 'Icon' });
    await createProject(page, { urls: ['letter.example.com'], name: 'Letter' });
    await page.goto('/app/projects');

    // The project's card on the projects list, where uier #47 was reported
    const card = page.getByRole('list', { name: 'Active projects' }).getByRole('listitem')
        .filter({ has: page.getByRole('link', { name: 'Icon', exact: true }) });
    await expect(card.locator('img')).toBeVisible();
    await expect(card.locator('img')).toHaveAttribute('src', /^\/api\/projects\/[a-z0-9]{12}\/icon\?site=https%3A%2F%2Ficon\.example\.com$/);
    // The site's SVG never runs as a uier.io page, also behind the app's own page policy
    const served = await page.request.get((await card.locator('img').getAttribute('src'))!);
    expect(served.headers()).toMatchObject({ 'content-type': 'image/svg+xml', 'content-disposition': 'attachment; filename="icon"',
        'cache-control': 'private, max-age=86400',
        'content-security-policy': 'default-src \'none\'; style-src \'unsafe-inline\'; sandbox' });
    const navigation = await appNavigation(page);
    const projects = navigation.getByRole('link', { name: 'Projects', exact: true });
    const withFavicon = navigation.getByRole('link', { name: 'Icon', exact: true });
    const withLetter = navigation.getByRole('link', { name: 'Letter', exact: true });

    // The favicon sits in a 20 px tile inside its border and 2 px padding, like the project header and the projects list;
    // a site without one shows the name's first letter
    const favicon = withFavicon.locator('img');
    await expect(favicon).toBeVisible();
    expect(await favicon.evaluate((image: HTMLImageElement) => {
        const style = getComputedStyle(image);
        return [image.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
            image.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)];
    })).toEqual([14, 14]);
    await expect(withLetter.locator(':scope > span[aria-hidden="true"]')).toHaveText('L');

    // Sheet or expanded sidebar: tiles centred on the page icons' column, names start where the pages' names do
    const pageItem = await linkParts(projects);
    for (const link of [withFavicon, withLetter]) {
        const { link: row, icon, label } = await linkParts(link);
        expect(icon.width).toBeCloseTo(20, 1);
        expect(icon.height).toBeCloseTo(20, 1);
        expect(icon.centerX).toBeCloseTo(pageItem.icon.centerX, 1);
        expect(icon.centerY).toBeCloseTo(row.centerY, 1);
        expect(label.x).toBeCloseTo(pageItem.label.x, 1);
    }

    // Collapsed to icons (desktop only, small screens use the sheet): each tile is whole and centred in its button
    if (isMobile)
        return;
    // The panel header's button (the sidebar's edge, a rail with the same name, is for the pointer only)
    await page.getByRole('main').getByRole('button', { name: 'Toggle sidebar' }).click();
    await expect(page.locator('[data-slot="sidebar"][data-collapsible="icon"]')).toHaveCount(1);
    await animationsFinished(page.locator('body'));
    const collapsedPage = await linkParts(projects);
    for (const link of [withFavicon, withLetter]) {
        const { link: button, icon } = await linkParts(link);
        expect(button.width).toBeCloseTo(32, 1);
        expect(icon.width).toBeCloseTo(20, 1);
        expect(icon.centerX).toBeCloseTo(button.centerX, 1);
        expect(icon.centerY).toBeCloseTo(button.centerY, 1);
        expect(icon.centerX).toBeCloseTo(collapsedPage.icon.centerX, 1);
    }
    expect(siteRequests).toEqual([]);
});
