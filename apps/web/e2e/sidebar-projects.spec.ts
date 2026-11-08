import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { appNavigation, createProject, hydrated, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished } from './support/toolbar';

// The sidebar's active projects (uier #32): sorted by recent activity or by name, grouped by client, remembered.

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

/** The sidebar's project links in order (not Create project); each name ends the link's text, after its tile's letter */
const projectLinks = (page: Page) => page.getByRole('navigation', { name: 'App' }).locator('a[href^="/app/projects/"]:not([href="/app/projects/new"])');
const inOrder = (...names: string[]) => names.map(name => new RegExp(`${name}$`));

/** Opens the sort menu (from the keyboard, so the menu and its trigger stay reachable without a pointer) */
async function openSortMenu(page: Page) {
    const navigation = await appNavigation(page);
    const trigger = navigation.getByRole('button', { name: 'Sort projects' });
    await hydrated(trigger);
    // On phones the pointer stays where Toggle sidebar was tapped, over the workspace switcher in the sheet:
    // rest it on the plain label (on the trigger, its tooltip would take the next Escape)
    await navigation.getByText('Active projects', { exact: true }).hover();
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await animationsFinished(menu);
    return menu;
}

/** The saved choice (the local HTTP name of `__Host-uier_project_order`) */
async function savedOrder(page: Page) {
    return (await page.context().cookies()).find(cookie => cookie.name === 'uier_project_order')?.value;
}

test('the sidebar sorts the active projects by recent activity or by name, groups them by client and remembers it', async ({ page, request }) => {
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

    // Alphabetical, chosen with the keyboard; the menu stays open for the grouping
    let menu = await openSortMenu(page);
    await expect(menu.getByRole('group', { name: 'Sort by' })).toBeVisible();
    await expect(menu.getByRole('menuitemradio', { name: 'Recent activity' })).toHaveAttribute('aria-checked', 'true');
    await expect(menu.getByRole('menuitemcheckbox', { name: 'Group by client' })).toHaveAttribute('aria-checked', 'false');
    await expectNoAxeViolations(page);
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: 'Alphabetical' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu.getByRole('menuitemradio', { name: 'Alphabetical' })).toHaveAttribute('aria-checked', 'true');
    await expect(projectLinks(page)).toHaveText(inOrder('Alpha', 'Bravo', 'Charlie', 'Delta'));

    // Grouped: clients by name, each client's projects a list named by the client, the rest last
    await menu.getByRole('menuitemcheckbox', { name: 'Group by client' }).click();
    await expect(menu.getByRole('menuitemcheckbox', { name: 'Group by client' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
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
    menu = await openSortMenu(page);
    await expect(menu.getByRole('menuitemradio', { name: 'Alphabetical' })).toHaveAttribute('aria-checked', 'true');
    await expect(menu.getByRole('menuitemcheckbox', { name: 'Group by client' })).toHaveAttribute('aria-checked', 'true');
    await menu.getByRole('menuitemradio', { name: 'Recent activity' }).click();
    await page.keyboard.press('Escape');
    await expect(projectLinks(page)).toHaveText(inOrder('Charlie', 'Bravo', 'Delta', 'Alpha'));
    await expect(navigation.getByRole('list', { name: 'Zeta Co' }).getByRole('link')).toHaveText(inOrder('Charlie', 'Bravo'));
    await expect.poll(() => savedOrder(page)).toBe('recent.client');
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

// uier #44: favicons are drawn for 16 px, so the sidebar shows them at that size, in the column of the page icons
test('the sidebar shows project favicons at 16 px with names in line with the pages above', async ({ page, isMobile }) => {
    // The browser loads a favicon from the project's own site over HTTPS: one site has one, the other none.
    // Any path: the server render preloads `/favicon.ico` through a Link header, which routing does not see
    await page.route('https://icon.example.com/**', route => route.fulfill({ contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" rx="3"/></svg>' }));
    await page.route('https://letter.example.com/**', route => route.fulfill({ status: 404 }));
    await signIn(page, uniqueEmail('project-icons'));
    await createProject(page, { urls: ['icon.example.com'], name: 'Icon' });
    await createProject(page, { urls: ['letter.example.com'], name: 'Letter' });
    await page.goto('/app/projects');
    const navigation = await appNavigation(page);
    const projects = navigation.getByRole('link', { name: 'Projects', exact: true });
    const withFavicon = navigation.getByRole('link', { name: 'Icon', exact: true });
    const withLetter = navigation.getByRole('link', { name: 'Letter', exact: true });

    // The favicon fills a 20 px tile inside its border and 1 px padding; a site without one shows the name's first letter
    const favicon = withFavicon.locator('img');
    await expect(favicon).toBeVisible();
    expect(await favicon.evaluate((image: HTMLImageElement) => {
        const style = getComputedStyle(image);
        return [image.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
            image.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)];
    })).toEqual([16, 16]);
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
});
