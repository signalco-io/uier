import { expect, test, type Page } from '@playwright/test';
import { appNavigation, closeAppNavigation, createProject, hydrated, signIn, uniqueEmail } from './support/app';
import { animationsFinished } from './support/toolbar';
import { loadAppCatalog } from '../src/lib/i18n/catalog';
import { createAppTranslator } from '../src/lib/i18n/translate';

/** What this browser keeps in the app's IndexedDB database (`uier-app`, `src/lib/app/browserCache.ts`), by key */
async function stored(page: Page) {
    return page.evaluate(() => new Promise<Record<string, unknown>>((resolve, reject) => {
        const request = indexedDB.open('uier-app');
        request.onupgradeneeded = () => request.result.createObjectStore('entries');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const database = request.result;
            const store = database.transaction('entries').objectStore('entries');
            const keys = store.getAllKeys();
            const values = store.getAll();
            values.onsuccess = () => {
                database.close();
                // Blobs (favicons) are not serializable to the test: their presence is enough
                resolve(Object.fromEntries(keys.result.map((key, index) => {
                    const value = values.result[index] as { blob?: unknown };
                    return [String(key), value && typeof value === 'object' && 'blob' in value ? 'image' : value];
                })));
            };
            values.onerror = () => reject(values.error);
        };
    }));
}

const shellKeys = (entries: Record<string, unknown>) => Object.keys(entries).filter(key => key.startsWith('shell:')).sort();
const sidebarFavicon = /^image:\/api\/projects\/[a-z0-9]{12}\/icon\?site=https%3A%2F%2Ficon\.example\.com&size=14$/;

/** Holds the requests `matches` picks until `release` is called, so the page stays in between */
async function hold(page: Page, matches: (request: { method: string; url: URL; headers: Record<string, string> }) => boolean) {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(() => true, async route => {
        const request = route.request();
        if (matches({ method: request.method(), url: new URL(request.url()), headers: request.headers() }))
            await held;
        await route.fallback();
    });
    return async () => {
        release();
        await page.unrouteAll({ behavior: 'wait' });
    };
}

async function workspaceMenu(page: Page) {
    await appNavigation(page);
    await page.getByRole('button', { name: /^Workspace:/ }).click();
    const menu = page.getByRole('menu');
    await animationsFinished(menu);
    return menu;
}

async function accountMenu(page: Page) {
    await appNavigation(page);
    await page.getByRole('button', { name: /^Account: / }).click();
    const menu = page.getByRole('menu');
    await animationsFinished(menu);
    return menu;
}

test('switching workspaces and accounts draws the destination from this browser while the server opens it', async ({ page, isMobile }) => {
    // The copy is the docked sidebar's: on phones the sidebar is a closed sheet, so there is nothing of it to see
    test.skip(isMobile, 'The docked sidebar draws the copy');
    const a = uniqueEmail('shell-cache-a');
    const b = uniqueEmail('shell-cache-b');
    await signIn(page, a);
    // icon.example.com has a favicon (e2e/support/siteIconsStub.ts)
    await createProject(page, { urls: ['icon.example.com'], name: 'Cached site' });
    await expect((await appNavigation(page)).getByRole('link', { name: 'Cached site', exact: true }).locator('img')).toBeVisible();
    await closeAppNavigation(page);

    // A second workspace: each workspace the shell renders is kept, with the favicons the page loaded
    await (await workspaceMenu(page)).getByRole('menuitem', { name: 'Create workspace' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create workspace' });
    await dialog.getByLabel('Workspace name').fill('Second space');
    await dialog.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page).toHaveURL(/\/app\/projects\/new$/);
    await expect.poll(async () => shellKeys(await stored(page)).length).toBe(2);
    await expect.poll(async () => Object.keys(await stored(page)).some(key => sidebarFavicon.test(key))).toBe(true);
    const entries = await stored(page);
    const userA = decodeURIComponent(shellKeys(entries)[0]!.split(':')[1]!);
    expect(shellKeys(entries).every(key => key.startsWith(`shell:${encodeURIComponent(userA)}:`))).toBe(true);
    // The next full load draws the workspace the shell shows now
    expect(entries['shell-current']).toEqual({ userId: userA, workspaceId: expect.not.stringMatching(new RegExp(`^w_${userA}$`)) });
    // No comments, tokens or passwords: the sidebar's own fields
    const snapshot = entries[shellKeys(entries)[0]!] as { sidebar: Record<string, unknown> };
    expect(Object.keys(snapshot.sidebar).sort()).toEqual(['accounts', 'currentWorkspaceId', 'hasClients', 'isAdmin', 'projectOrder', 'projects', 'user', 'workspaces']);

    // Switching back: the first workspace's sidebar, favicon included, at once, while the server action is held
    const releaseSwitch = await hold(page, request => request.method === 'POST' && Boolean(request.headers['next-action']));
    await (await workspaceMenu(page)).getByRole('menuitem', { name: /^Personal/ }).click();
    const copy = page.locator('[data-cached-shell]');
    await expect(copy).toBeVisible();
    await expect(copy).toHaveAttribute('data-switching', '');
    await expect(copy).toHaveAttribute('aria-hidden', 'true');
    await expect(copy.locator('[data-slot="sidebar"]')).toContainText('Personal');
    await expect(copy.locator('[data-slot="sidebar"]')).toContainText('Cached site');
    await expect(copy.locator('[data-mark-icon]').first()).toHaveAttribute('style', /url\("blob:/);
    await expect(page.locator('[data-app-shell]')).toBeHidden();
    await releaseSwitch();
    await expect(copy).toHaveCount(0);
    await expect(page.locator('[data-app-shell]')).toBeVisible();
    await expect((await appNavigation(page)).getByRole('link', { name: 'Cached site', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Workspace:/ })).toContainText('Personal');
    await closeAppNavigation(page);

    // A second account, then back to the first: its workspace is drawn while the switch is held
    await (await accountMenu(page)).getByRole('menuitem', { name: 'Add account', exact: true }).click();
    await signIn(page, b, { from: page.url() });
    await expect.poll(async () => shellKeys(await stored(page)).length).toBe(3);
    const releaseAccount = await hold(page, request => request.method === 'POST' && request.url.pathname === '/api/account/sessions');
    await (await accountMenu(page)).getByRole('menuitem', { name: new RegExp(`${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).click();
    await expect(copy).toBeVisible();
    await expect(copy.locator('[data-slot="sidebar"]')).toContainText('Personal');
    await expect(copy.locator('[data-slot="sidebar"]')).toContainText('Cached site');
    // The next document starts from the same copy: the account's own workspace, since it is not in the second one's
    expect((await stored(page))['shell-current']).toEqual({ userId: userA, workspaceId: `w_${userA}` });
    const navigated = page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() });
    await releaseAccount();
    await navigated;
    await expect((await appNavigation(page)).getByRole('link', { name: 'Cached site', exact: true })).toBeVisible();
    await expect(copy).toHaveCount(0);
    await closeAppNavigation(page);

    // Signing out of every account removes every copy
    await (await accountMenu(page)).getByRole('menuitem', { name: 'Sign out of all accounts' }).click();
    await expect(page).toHaveURL(/\/app\/sign-in$/);
    const left = await stored(page);
    expect(Object.keys(left).filter(key => key.startsWith('shell') || key.startsWith('image:'))).toEqual([]);
});

test('a load into the shell draws this browser\'s copy in the frame\'s place, in the app\'s language', async ({ page, isMobile }) => {
    test.skip(isMobile, 'The docked sidebar draws the copy');
    await signIn(page, uniqueEmail('shell-cache-load'));
    await createProject(page, { urls: ['icon.example.com'], name: 'Cached site' });
    // Croatian, so the copy's words come from the catalog this browser kept
    await page.goto('/app/account');
    const language = page.locator('#app-language');
    await hydrated(language.locator('form'));
    await language.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Hrvatski', exact: true }).click();
    await language.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('[data-app-language]')).toHaveAttribute('lang', 'hr');
    const t = createAppTranslator(await loadAppCatalog('hr'));
    await page.goto('/app/projects');
    await expect.poll(async () => {
        const entries = await stored(page);
        return [Boolean(entries['catalog:hr']), (entries[shellKeys(entries)[0]!] as { language?: string } | undefined)?.language,
            Object.keys(entries).some(key => sidebarFavicon.test(key))];
    }).toEqual([true, 'hr', true]);

    // From a page outside the shell into it, with the server's shell held: the copy draws where the frame would
    await page.goto('/app/projects/aaaaaaaaaaaa');
    // The link's static shell (the frame, with the copy beside it) is prefetched before the server's render is held
    await page.waitForLoadState('networkidle');
    const release = await hold(page, request => request.method === 'GET' && request.url.pathname.startsWith('/app/projects')
        && Boolean(request.headers.rsc || request.url.searchParams.has('_rsc')));
    await page.getByRole('link', { name: t('Open your projects'), exact: true }).click();
    const copy = page.locator('[data-cached-shell]');
    await expect(copy).toBeVisible();
    await expect(copy).not.toHaveAttribute('data-switching');
    await expect(page.locator('[data-shell-frame]')).toBeHidden();
    const sidebar = copy.locator('[data-slot="sidebar"]');
    await expect(sidebar).toContainText(t('My work'));
    await expect(sidebar).toContainText('Personal');
    await expect(sidebar).toContainText('Cached site');
    await expect(copy.locator('[data-mark-icon]').first()).toHaveAttribute('style', /url\("blob:/);
    await expect(copy.locator('header')).toContainText(t('Projects'));
    // The live shell takes over and the copy leaves the document
    await release();
    await expect(page.locator('[data-app-shell]')).toBeVisible();
    await expect(copy).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('lang', 'hr');
});
