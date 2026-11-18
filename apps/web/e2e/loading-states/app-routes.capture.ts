import { expect, test, type Page } from '@playwright/test';
import { createProject, setProjectAccess, signIn, uniqueEmail } from '../support/app';
import { verifiedReviewHeaders } from '../support/reviewVerification';
import { startReviewedSite } from '../support/reviewedSite';
import { Capture, firstPaint, hardLoad, softNav } from './capture';

// Every app route held in its loading state: the static shell of a full load, and the prefetched shell of a client
// navigation from a page that makes the route's own fallback the outermost new boundary.

async function createTeam(page: Page, name: string) {
    await page.goto('/app/workspace/teams');
    await page.getByRole('button', { name: 'Create team', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Team name').fill(name);
    await dialog.getByLabel('Description').fill('People who review the product.');
    await dialog.getByRole('button', { name: 'Save team' }).click();
    await dialog.getByRole('link', { name: 'Open team' }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    return new URL(page.url()).pathname;
}

test('app routes', async ({ page, request, baseURL, browser }, info) => {
    const capture = new Capture(info, 'app-routes');
    const origin = new URL(baseURL!).origin;
    const site = await startReviewedSite(origin);
    try {
        // A workspace with what the pages show: a client, two projects, comments, a team
        await signIn(page, uniqueEmail('loading'));
        const shop = await createProject(page, { urls: [site.origin()], name: 'Shop', clientName: 'Acme' });
        await setProjectAccess(page, shop, 'Anyone with the link');
        const headers = await verifiedReviewHeaders(request, shop, site.origin());
        const texts = ['Checkout total is wrong', 'Hero image is blurry on retina screens', 'Footer links overlap on small screens', 'Pricing table needs a yearly toggle',
            'Typo in the shipping policy', 'Search returns nothing for "shoes"', 'Newsletter form has no confirmation', 'Cart badge shows the wrong count'];
        for (const [index, text] of texts.entries()) {
            const response = await request.post(`/api/review/${shop}/comments`, { headers, data: {
                path: `/${shop}/${index % 2 ? 'pricing' : 'checkout'}`, text: index === 0 ? `${text}. ${'The sum under the cart does not include shipping until the page is reloaded. '.repeat(9)}` : text,
                authorName: 'Guest reviewer', position: { type: 'page' }, kind: 'feedback'
            } });
            expect(response.status(), await response.text()).toBe(201);
        }
        // No comments yet, so it still has its Install tab
        const docs = `/app/projects/${await createProject(page, { urls: ['https://docs.example.com'], name: 'Docs site' })}`;
        const team = await createTeam(page, 'Design review');
        await page.goto('/app/workspace/users');
        const person = await page.locator('main a[href^="/app/workspace/users/"]').first().getAttribute('href');
        expect(person).toBeTruthy();

        const project = `/app/projects/${shop}`;
        const settings = `${project}/settings`;

        // --- Full loads: the static shell ---------------------------------------------------------------------------
        const hard: [id: string, title: string, route: string, group?: string][] = [
            ['projects', 'Projects', '/app/projects'],
            ['my-work', 'My work', '/app/my-work'],
            ['project-comments', 'Project: Comments', project],
            ['project-page-checks', 'Project: Page checks', `${project}/page-checks`],
            ['project-settings', 'Project: Settings', settings],
            ['account', 'Account', '/app/account'],
            ['workspace-users', 'Workspace: Users', '/app/workspace/users'],
            ['connect-error', 'Connect: error', '/app/connect/error'],
            ['review-link', 'Review link', `/app/review/${shop}`],
        ];
        for (const [id, title, route] of hard)
            await hardLoad(capture, page, baseURL!, { id: `hard-${id}`, surface: 'app', group: 'Full load: static shell', title, route }, { loaded: id === 'projects' });
        await firstPaint(capture, page, { id: 'hard-denied', surface: 'app', group: 'Full load: static shell', title: 'A project the account cannot open (404)', route: '/app/projects/aaaaaaaaaaaa',
            note: 'Not held by the lock (a 404 has no prerendered shell): the document\'s own first bytes.' });

        // --- Entering the shell -------------------------------------------------------------------------------------
        await softNav(capture, page, { id: 'shell-enter', surface: 'app', group: 'Entering the app shell', title: 'App shell (ShellLoading)',
            from: '/app/connect/error', route: '/app/projects', note: 'From a page outside the sidebar layout: what a full load shows between the language and the workspace reads.' }, { loaded: false });

        // --- Client navigations -------------------------------------------------------------------------------------
        const soft: [id: string, group: string, title: string, from: string, route: string, note?: string][] = [
            ['projects', 'Top-level pages', 'Projects', '/app/my-work', '/app/projects'],
            ['my-work', 'Top-level pages', 'My work', '/app/projects', '/app/my-work'],
            ['projects-new', 'Top-level pages', 'Create project', '/app/projects', '/app/projects/new'],

            ['project-comments-list', 'Project', 'Comments (list), entering the project', '/app/projects', project, 'The project layout and its page load together.'],
            ['project-comments-tab', 'Project', 'Comments (list), from another tab', `${project}/page-checks`, project, 'The project layout is kept.'],
            ['project-comments-done', 'Project', 'Comments (list, Done), from another tab', `${project}/page-checks`, `${project}?status=done`],
            ['project-comments-board', 'Project', 'Comments (board), from another tab', `${project}/page-checks`, `${project}?view=board`],
            ['project-comments-empty', 'Project', 'Comments, a project without comments', '/app/projects', docs, 'The skeleton cannot know the project is empty.'],
            ['project-page-checks-enter', 'Project', 'Page checks, entering the project', '/app/projects', `${project}/page-checks`],
            ['project-page-checks-tab', 'Project', 'Page checks, from another tab', project, `${project}/page-checks`],
            ['project-install-enter', 'Project', 'Install, entering the project', '/app/projects', `${docs}/install?onboarding=1`, 'Onboarding step 2: the header, the tabs and the page load together.'],
            ['project-install-tab', 'Project', 'Install, from another tab', docs, `${docs}/install?onboarding=1`],

            ['settings-enter', 'Project settings', 'General, entering the project', '/app/projects', settings],
            ['settings-from-tab', 'Project settings', 'General, from the Comments tab', project, settings, 'The settings layout (its section links) loads with the page.'],
            ['settings-general', 'Project settings', 'General, from another section', `${settings}/review`, settings],
            ['settings-review', 'Project settings', 'Review', settings, `${settings}/review`],
            ['settings-people', 'Project settings', 'People and teams', settings, `${settings}/people`],
            ['settings-notifications', 'Project settings', 'Notifications', settings, `${settings}/notifications`],
            ['settings-environments', 'Project settings', 'Environments', settings, `${settings}/environments`],
            ['settings-installation', 'Project settings', 'Installation', settings, `${settings}/installation`],
            ['settings-integrations', 'Project settings', 'Integrations', settings, `${settings}/integrations`],
            ['settings-integration', 'Project settings', 'Integration: GitHub', `${settings}/integrations`, `${settings}/integrations/github`],
            ['settings-danger', 'Project settings', 'Danger zone', settings, `${settings}/danger-zone`],

            ['account-enter', 'Account', 'General, entering Account', '/app/projects', '/app/account'],
            ['account-general', 'Account', 'General, from another section', '/app/account/sign-in', '/app/account'],
            ['account-sign-in', 'Account', 'Sign-in', '/app/account', '/app/account/sign-in'],
            ['account-notifications', 'Account', 'Notifications', '/app/account', '/app/account/notifications'],
            ['account-usage', 'Account', 'Usage', '/app/account', '/app/account/usage'],
            ['account-coding-agents', 'Account', 'Coding agents', '/app/account', '/app/account/coding-agents'],

            ['workspace-enter', 'Workspace', 'Users, entering Workspace', '/app/projects', '/app/workspace/users', 'The workspace layout (name and tabs) loads with the page.'],
            ['workspace-users', 'Workspace', 'Users, from another tab', '/app/workspace/teams', '/app/workspace/users'],
            ['workspace-teams', 'Workspace', 'Teams', '/app/workspace/users', '/app/workspace/teams'],
            ['workspace-clients', 'Workspace', 'Clients', '/app/workspace/users', '/app/workspace/clients'],
            ['workspace-usage', 'Workspace', 'Usage', '/app/workspace/users', '/app/workspace/usage'],
            ['workspace-activity', 'Workspace', 'Activity', '/app/workspace/users', '/app/workspace/activity'],
            ['workspace-settings', 'Workspace', 'Settings', '/app/workspace/users', '/app/workspace/settings'],
            ['workspace-team', 'Workspace', 'A team', '/app/workspace/teams', team],
            ['workspace-person', 'Workspace', 'A person', '/app/workspace/users', person!],

            ['connect-error', 'Outside the shell', 'Connect: error page, from the app', '/app/projects', '/app/connect/error', 'Leaves the sidebar layout.'],
            ['connect-request', 'Outside the shell', 'Connect: consent, from the error page', '/app/connect/error', '/app/connect/unknown-request'],
            // Signed-in pages on the sign-in card: the card's layout is new, so the page's own fallback shows inside it
            ['auth-welcome', 'Sign-in card pages', 'Welcome (first run)', '/app/projects', '/app/welcome'],
            ['auth-join', 'Sign-in card pages', 'Join a workspace', '/app/projects', '/app/join'],
            ['auth-extension', 'Sign-in card pages', 'Browser extension sign-in', '/app/projects', '/app/extension'],
        ];
        for (const [id, group, title, from, route, note] of soft)
            await softNav(capture, page, { id: `soft-${id}`, surface: 'app', group, title, from, route, note }, { loaded: id !== 'connect-request' && !id.startsWith('auth-') });

        // A remembered Board opens the project as a board
        await page.context().addCookies([{ name: 'uier_comments_view', value: 'board', url: baseURL! }]);
        await softNav(capture, page, { id: 'soft-project-comments-board-enter', surface: 'app', group: 'Project', title: 'Comments (board remembered), entering the project',
            from: '/app/projects', route: project, note: 'The view cookie says Board.' });
        await page.context().clearCookies({ name: 'uier_comments_view' });

        // --- Signed out: the sign-in card's pages -------------------------------------------------------------------
        const use = info.project.use;
        const guest = await browser.newContext({ baseURL, viewport: use.viewport, deviceScaleFactor: use.deviceScaleFactor, isMobile: use.isMobile, hasTouch: use.hasTouch, userAgent: use.userAgent });
        const visitor = await guest.newPage();
        await hardLoad(capture, visitor, baseURL!, { id: 'hard-sign-in', surface: 'app', group: 'Full load: static shell', title: 'Sign in (signed out)', route: '/app/sign-in' }, { loaded: true });
        const auth: [id: string, title: string, from: string, route: string][] = [
            ['sign-in', 'Sign in', '/app/sign-in/confirm', '/app/sign-in'],
            ['sign-in-confirm', 'Sign in: confirm', '/app/sign-in', '/app/sign-in/confirm'],
            ['sign-in-google-link', 'Sign in: link Google', '/app/sign-in', '/app/sign-in/google/link'],
            ['sign-in-microsoft-link', 'Sign in: link Microsoft', '/app/sign-in', '/app/sign-in/microsoft/link'],
            ['invitation', 'Invitation', '/app/sign-in', '/app/invitation'],
        ];
        for (const [id, title, from, route] of auth)
            await softNav(capture, visitor, { id: `soft-auth-${id}`, surface: 'app', group: 'Sign-in card pages', title, from, route }, { loaded: false });
        await guest.close();
    } finally {
        capture.save();
        await site.close();
    }
});
