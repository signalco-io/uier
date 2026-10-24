import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Browser, Page, TestInfo } from '@playwright/test';
import { startReviewedSite } from './support/reviewedSite';
import { expectNoAxeViolations } from './accessibility';
import { createProject, signIn, uniqueEmail } from './support/app';
import { commentBubble, commentBubbles, newVisitor, openThread, selectText, selectionToolbar, toolbar } from './support/toolbar';

// The review flow of a project (issue #34): a reviewed site on another origin embeds the toolbar
// with the project's script from the install guide, and sends the Content-Security-Policy the
// install guide's "Advanced" section lists. The project's "who can comment" setting is enforced by
// the review API (app/api/review) and shown by the toolbar.

let site: Awaited<ReturnType<typeof startReviewedSite>>;
let sitePort: number;

/** `http://<label>.localhost:<port>`: a loopback origin that is another site than the app on 127.0.0.1 */
function siteOrigin(label = 'reviewed') {
    return site.origin(label);
}

test.beforeAll(async ({ baseURL }) => {
    site = await startReviewedSite(new URL(baseURL!).origin);
    sitePort = Number(new URL(site.origin()).port);
});

test.afterAll(async () => {
    await site.close();
});

/** Fails the test when the page reports a CSP violation (the install guide's sources must be enough) */
async function watchCsp(page: Page) {
    const violations: string[] = [];
    page.on('console', message => {
        if (/Content Security Policy/i.test(message.text()))
            violations.push(message.text());
    });
    return violations;
}

async function setAccess(page: Page, projectId: string, label: 'Invited people' | 'Anyone with the link' | 'Comments off') {
    await page.goto(`/app/projects/${projectId}/settings`);
    const access = page.getByRole('region', { name: 'Comments' });
    await access.getByRole('combobox').click();
    await page.getByRole('option', { name: label }).click();
    await access.getByRole('button', { name: 'Save' }).click();
    await expect(access.getByRole('status')).toContainText('Saved.');
}

/** Pins a point comment on the page's heading from the toolbar */
async function addPointComment(page: Page, text: string, { name }: { name?: string } = {}) {
    await page.getByRole('button', { name: 'Add comment' }).click();
    const heading = await page.getByRole('heading', { level: 1 }).boundingBox();
    expect(heading).not.toBeNull();
    await page.mouse.click(heading!.x + 20, heading!.y + heading!.height / 2);
    if (name)
        await page.getByRole('textbox', { name: 'Your name' }).fill(name);
    const composer = page.getByRole('textbox', { name: 'Comment', exact: true });
    await composer.fill(text);
    await composer.press('Enter');
    await expect(commentBubble(page, 1)).toBeVisible();
}

/** An owner with a project for the reviewed site, signed in on `page` */
async function ownerWithProject(page: Page) {
    await signIn(page, uniqueEmail('owner'));
    const projectId = await createProject(page, { urls: [siteOrigin()], name: 'Reviewed site' });
    return projectId;
}

async function anonymousVisitor(browser: Browser, testInfo: TestInfo) {
    return await newVisitor(browser, testInfo);
}

test('invited people only: a review link signs members in, everyone else is asked to sign in', async ({ page, browser }, testInfo) => {
    const projectId = await ownerWithProject(page);

    // Someone without access sees the toolbar ask them to sign in, and no comments
    const stranger = await anonymousVisitor(browser, testInfo);
    const strangerViolations = await watchCsp(stranger.page);
    await stranger.page.goto(`${siteOrigin()}/${projectId}/pricing?toolbar-code=${projectId}`);
    await expect(toolbar(stranger.page)).toContainText('Sign in to see and leave comments.');
    await expect(stranger.page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(stranger.page.getByRole('button', { name: 'Exit review' })).toBeVisible();
    await expect(stranger.page.getByRole('button', { name: 'Add comment' })).toHaveCount(0);
    expect(strangerViolations).toEqual([]);

    // "Sign in" goes through the project's review link on uier (sign in, then back to the page)
    await stranger.page.getByRole('button', { name: 'Sign in' }).click();
    await expect(stranger.page).toHaveURL(/\/app\/sign-in\?next=%2Fapp%2Freview%2F/);
    await stranger.context.close();

    // The owner opens the review link from the app: the toolbar is signed in on the site
    const violations = await watchCsp(page);
    await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(`${siteOrigin()}/${projectId}/pricing`)}`);
    // The single-use code is gone from the address once the toolbar used it
    await expect(page).toHaveURL(`${siteOrigin()}/${projectId}/pricing?toolbar-code=${projectId}`);
    await expect(toolbar(page)).toBeVisible();
    await addPointComment(page, 'The yearly price is missing.');
    // Posting opens the thread
    await expect(openThread(page).getByText('You', { exact: true })).toBeVisible();
    await expect(openThread(page).getByRole('button', { name: 'Mark as done' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(openThread(page)).toBeHidden();
    // Before axe, which fetches the page's stylesheets itself (blocked by connect-src)
    expect(violations).toEqual([]);
    await expectNoAxeViolations(page);

    // The token survives a reload (kept in the site's local storage)
    await page.reload();
    await expect(commentBubbles(page)).toHaveCount(1);

    // The comment in the app: page, device, author, state
    await page.goto(`/app/projects/${projectId}`);
    const comment = page.getByRole('article', { name: 'Comment by you' });
    await expect(comment).toContainText('The yearly price is missing.');
    await expect(comment).toContainText(`reviewed.localhost:${sitePort}/${projectId}/pricing`);
    await expect(comment).toContainText(testInfo.project.name.startsWith('Mobile') ? 'Mobile' : 'Desktop');
    await expect(comment).toContainText('Open');
});

test('guest mode: anyone with the link comments under their name', async ({ page, browser }, testInfo) => {
    const projectId = await ownerWithProject(page);
    await setAccess(page, projectId, 'Anyone with the link');
    await page.goto(`/app/projects/${projectId}`);
    await expect(page.getByRole('region', { name: 'Guest link' })).toContainText(`${siteOrigin()}/?toolbar-code=${projectId}`);

    const guest = await anonymousVisitor(browser, testInfo);
    const violations = await watchCsp(guest.page);
    await guest.page.goto(`${siteOrigin()}/${projectId}/?toolbar-code=${projectId}`);
    await expect(guest.page.getByRole('button', { name: 'Add comment' })).toBeVisible();

    // The name is asked for once
    await addPointComment(guest.page, 'Can the button be bigger?', { name: 'Ana Guest' });
    // Posting opens the thread
    const thread = openThread(guest.page);
    await expect(thread.getByText('You', { exact: true })).toBeVisible();
    const reply = thread.getByRole('textbox', { name: 'Reply' });
    await expect(thread.getByRole('textbox', { name: 'Your name' })).toHaveCount(0);
    await reply.fill('On mobile especially.');
    await reply.press('Enter');
    await expect(commentBubble(guest.page, 2)).toBeVisible();
    expect(violations).toEqual([]);
    await guest.context.close();

    // The owner sees the guest's name in the app
    await page.goto(`/app/projects/${projectId}`);
    const comment = page.getByRole('article', { name: 'Comment by Ana Guest' });
    await expect(comment).toContainText('Can the button be bigger?');
    await comment.getByRole('button', { name: '1 reply' }).click();
    await expect(comment).toContainText('On mobile especially.');
});

test('a React site adds the project\'s toolbar with the React component', async ({ page, browser, baseURL }, testInfo) => {
    const projectId = await ownerWithProject(page);
    await setAccess(page, projectId, 'Anyone with the link');
    const appOrigin = new URL(baseURL!).origin;

    // `<UierToolbar project={projectId} />`, opened with `?review=true`: the link has no project code
    const guest = await anonymousVisitor(browser, testInfo);
    const violations = await watchCsp(guest.page);
    const reviewInfo = guest.page.waitForResponse(response => response.request().method() === 'GET'
        && new URL(response.url()).pathname === `/api/review/${projectId}`);
    await guest.page.goto(`${siteOrigin()}/${projectId}/?review=true&embed=react`);
    await expect(guest.page.locator(`script[data-uier-mode="review"][data-uier-project="${projectId}"]`))
        .toHaveAttribute('src', `${appOrigin}/toolbar.js`);
    // The toolbar uses the project's review API
    expect((await reviewInfo).status()).toBe(200);
    await expect(guest.page.getByRole('button', { name: 'Add comment' })).toBeVisible();

    // "View project" opens the script's project
    await guest.page.getByRole('button', { name: 'Options', exact: true }).click();
    await expect(guest.page.getByRole('link', { name: 'View project' })).toHaveAttribute('href', `${appOrigin}/app/projects/${projectId}`);
    expect(violations).toEqual([]);
    await guest.context.close();
});

test('comments off: the toolbar says so and the API refuses', async ({ page, request }) => {
    const projectId = await ownerWithProject(page);
    await setAccess(page, projectId, 'Comments off');

    await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(`${siteOrigin()}/${projectId}/`)}`);
    await expect(toolbar(page)).toContainText('Comments are turned off for this project.');
    await expect(page.getByRole('button', { name: 'Add comment' })).toHaveCount(0);
    await expectNoAxeViolations(page);

    // The notice still ends the review: the toolbar leaves, also after a reload
    await expect(page).toHaveURL(`${siteOrigin()}/${projectId}/?toolbar-code=${projectId}`);
    await page.getByRole('button', { name: 'Exit review' }).click();
    await expect(page.locator('#uier-toolbar')).toHaveCount(0);
    await expect(page).toHaveURL(`${siteOrigin()}/${projectId}/`);
    // After the load event: the toolbar script has run (it is deferred) and mounts synchronously
    await page.reload();
    await expect(page.locator('#uier-toolbar')).toHaveCount(0);

    const response = await request.get(`/api/review/${projectId}/comments?path=/`, {
        headers: { Origin: siteOrigin(), 'X-Uier-Visitor': randomBytes(32).toString('base64url') }
    });
    expect(response.status()).toBe(403);
    expect((await response.json()).error).toBe('comments_disabled');
});

test('the toolbar works only on the project\'s own sites', async ({ page, request }) => {
    const projectId = await ownerWithProject(page);
    await setAccess(page, projectId, 'Anyone with the link');

    await page.goto(`${siteOrigin('elsewhere')}/${projectId}/?toolbar-code=${projectId}`);
    await expect(toolbar(page)).toContainText('uier can\'t open this project here.');
    await expect(page.getByRole('button', { name: 'Exit review' })).toBeVisible();

    // CORS: preflights are answered for the project's origins only
    const allowed = await request.fetch(`/api/review/${projectId}/comments`, {
        method: 'OPTIONS',
        headers: { Origin: siteOrigin(), 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-uier-visitor' }
    });
    expect(allowed.status()).toBe(204);
    expect(allowed.headers()['access-control-allow-origin']).toBe(siteOrigin());
    expect(allowed.headers()['access-control-allow-headers']).toContain('X-Uier-Visitor');
    expect(allowed.headers()['access-control-allow-credentials']).toBeUndefined();

    const refused = await request.fetch(`/api/review/${projectId}/comments`, {
        method: 'OPTIONS',
        headers: { Origin: siteOrigin('elsewhere'), 'Access-Control-Request-Method': 'POST' }
    });
    expect(refused.headers()['access-control-allow-origin']).toBeUndefined();

    const write = await request.post(`/api/review/${projectId}/comments`, {
        headers: { Origin: siteOrigin('elsewhere'), 'X-Uier-Visitor': randomBytes(32).toString('base64url') },
        data: { path: '/', position: { type: 'point', selector: 'body>main>h1', xNormal: 0.5, yNormal: 0.5 }, text: 'Hi', authorName: 'Eve' }
    });
    expect(write.status()).toBe(403);
});

test('rewrite suggestions on the project\'s site go through the review API', async ({ page, request, browser }, testInfo) => {
    const projectId = await ownerWithProject(page);
    await setAccess(page, projectId, 'Anyone with the link');

    // The guest's toolbar asks the project's review API (the e2e server's model is a stub)
    const guest = await anonymousVisitor(browser, testInfo);
    await guest.page.goto(`${siteOrigin()}/${projectId}/?toolbar-code=${projectId}`);
    await expect(guest.page.getByRole('button', { name: 'Add comment' })).toBeVisible();
    await selectText(guest.page, 'Every plan includes the toolbar.');
    await selectionToolbar(guest.page).getByRole('button', { name: 'Rewrite' }).click();
    const draft = guest.page.getByRole('dialog', { name: 'New rewrite suggestion' });
    // The name typed first stays when a suggestion replaces the text
    await draft.getByRole('textbox', { name: 'Your name' }).fill('Dana');
    const suggestRequest = guest.page.waitForRequest(r => r.method() === 'POST' && new URL(r.url()).pathname === `/api/review/${projectId}/rewrite`);
    await draft.getByRole('button', { name: 'Suggest', exact: true }).click();
    await suggestRequest;
    await draft.getByRole('group', { name: 'Suggestions' }).getByRole('button', { name: 'Second suggestion.' }).click();
    await expect(draft.getByRole('textbox', { name: 'Suggested text' })).toHaveValue('Second suggestion.');
    await expect(draft.getByRole('textbox', { name: 'Your name' })).toHaveValue('Dana');
    await draft.getByRole('button', { name: 'Post suggestion' }).click();
    await expect(openThread(guest.page).getByText('Suggested rewrite', { exact: true })).toBeVisible();
    await guest.context.close();

    // The app shows it as a suggested rewrite of the quoted text
    await page.goto(`/app/projects/${projectId}`);
    const card = page.getByRole('article', { name: 'Comment by Dana' });
    await expect(card).toContainText('Suggested rewrite');
    await expect(card).toContainText('Every plan includes the toolbar.');
    await expect(card).toContainText('Second suggestion.');

    // The same checks as the project's comments: its sites, a reviewer, comments on
    const headers = { Origin: siteOrigin(), 'X-Uier-Visitor': randomBytes(32).toString('base64url') };
    const suggest = async (data: unknown, requestHeaders: Record<string, string> = headers) =>
        await request.post(`/api/review/${projectId}/rewrite`, { headers: requestHeaders, data });
    const answered = await suggest({ text: 'Every plan includes the toolbar.', instruction: 'Shorter' });
    expect(answered.status()).toBe(200);
    expect(await answered.json()).toEqual({ suggestions: ['First suggestion (Shorter).', 'Second suggestion (Shorter).', 'Third suggestion (Shorter).'] });
    expect(answered.headers()['access-control-allow-origin']).toBe(siteOrigin());
    const failed = await suggest({ text: 'Every plan includes the toolbar.', instruction: '[stub:fail]' });
    expect(failed.status()).toBe(503);
    expect((await failed.json()).error).toBe('unavailable');
    expect((await suggest({})).status()).toBe(400);
    expect((await suggest({ text: 'Hi' }, { Origin: siteOrigin() })).status()).toBe(400);
    expect((await suggest({ text: 'Hi' }, { ...headers, Origin: siteOrigin('elsewhere') })).status()).toBe(403);
    const preflight = await request.fetch(`/api/review/${projectId}/rewrite`, {
        method: 'OPTIONS',
        headers: { Origin: siteOrigin(), 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-uier-visitor' }
    });
    expect(preflight.headers()['access-control-allow-methods']).toBe('POST');

    await setAccess(page, projectId, 'Comments off');
    const off = await suggest({ text: 'Hi' });
    expect(off.status()).toBe(403);
    expect((await off.json()).error).toBe('comments_disabled');
});

test('the app lists, filters and manages a project\'s comments', async ({ page, request }) => {
    const projectId = await ownerWithProject(page);
    await setAccess(page, projectId, 'Anyone with the link');

    // Two guests comment on two pages (through the review API, like their toolbar does)
    const guest = (name: string) => ({ token: randomBytes(32).toString('base64url'), name });
    const ana = guest('Ana');
    const ben = guest('Ben');
    const post = async (author: { token: string; name: string }, path: string, text: string, device: 'desktop' | 'mobile') => {
        const response = await request.post(`/api/review/${projectId}/comments`, {
            headers: { Origin: siteOrigin(), 'X-Uier-Visitor': author.token },
            data: { path, position: { type: 'point', selector: 'body>main>h1', xNormal: 0.5, yNormal: 0.5 }, text, authorName: author.name, device: { size: device } }
        });
        expect(response.status()).toBe(201);
        return (await response.json()) as { id: string };
    };
    // Pages of the reviewed site are /<project code>/<page>
    const pricing = `/${projectId}/pricing`;
    const about = `/${projectId}/about`;
    await post(ana, pricing, 'Pricing needs a table.', 'desktop');
    const benComment = await post(ben, about, 'Team photo is blurry.', 'mobile');

    // A guest's own view: a private comment of someone else is not listed
    const list = async (author: { token: string }, path: string) => {
        const response = await request.get(`/api/review/${projectId}/comments?path=${encodeURIComponent(path)}`, {
            headers: { Origin: siteOrigin(), 'X-Uier-Visitor': author.token }
        });
        expect(response.status()).toBe(200);
        return (await response.json()) as { id: string; private: boolean; permissions: { resolve: boolean; delete: boolean } }[];
    };
    expect(await list(ana, about)).toHaveLength(1);
    // Guests resolve and delete only their own comments
    expect((await list(ana, about))[0]!.permissions).toEqual({ resolve: false, delete: false });
    expect((await list(ben, about))[0]!.permissions).toEqual({ resolve: true, delete: true });

    await page.goto(`/app/projects/${projectId}`);
    await expect(page.getByRole('status').filter({ hasText: 'comments' })).toHaveText('2 comments');
    await expect(page).toHaveTitle('Reviewed site · uier');
    const benCard = page.getByRole('article', { name: 'Comment by Ben' });
    await expect(benCard).toContainText('Mobile');
    await expectNoAxeViolations(page);

    // Filter by page (relative URLs)
    await page.getByRole('combobox', { name: 'Page' }).click();
    await page.getByRole('option', { name: about }).click();
    await expect(page).toHaveURL(new RegExp(`page=${encodeURIComponent(about)}`));
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(benCard).toBeVisible();

    // Make private (admins): Ana no longer sees Ben's comment, Ben does
    await benCard.getByRole('button', { name: /More actions/ }).click();
    await page.getByRole('menuitem', { name: 'Make private' }).click();
    await expect(benCard).toContainText('Private');
    expect(await list(ana, about)).toHaveLength(0);
    expect(await list(ben, about)).toHaveLength(1);

    // Assign to me, then the "Assigned to me" filter
    await benCard.getByRole('button', { name: /More actions/ }).click();
    await page.getByRole('menuitem', { name: 'Assign' }).click();
    await page.getByRole('menuitem', { name: /^owner-/ }).click();
    await expect(benCard).toContainText(/Assignee\s*owner-/);
    await page.goto(`/app/projects/${projectId}`);
    await page.getByRole('combobox', { name: 'People' }).click();
    await page.getByRole('option', { name: 'Assigned to me' }).click();
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByRole('article', { name: 'Comment by Ben' })).toBeVisible();
    await page.getByRole('combobox', { name: 'People' }).click();
    await page.getByRole('option', { name: 'Opened by me' }).click();
    await expect(page.getByText('No comments match these filters.')).toBeVisible();

    // Board view: Open and Done columns; Done moves the comment
    await page.goto(`/app/projects/${projectId}?view=board`);
    const open = page.getByRole('region', { name: 'Open comments' });
    const done = page.getByRole('region', { name: 'Done comments' });
    await expect(open.getByRole('article')).toHaveCount(2);
    await open.getByRole('article', { name: 'Comment by Ana' }).getByRole('button', { name: 'Done' }).click();
    await expect(done.getByRole('article', { name: 'Comment by Ana' })).toBeVisible();
    await expect(open.getByRole('article')).toHaveCount(1);
    await expect(page).toHaveTitle('Reviewed site · uier');
    await expectNoAxeViolations(page);

    // Edit (admin) and link to comment
    const anaCard = done.getByRole('article', { name: 'Comment by Ana' });
    await anaCard.getByRole('button', { name: /More actions/ }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await page.getByRole('dialog').getByRole('textbox', { name: 'Text' }).fill('Pricing needs a comparison table.');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(anaCard).toContainText('Pricing needs a comparison table. (edited)');
    await expect(anaCard.getByRole('link', { name: new RegExp(`${pricing}$`) })).toHaveAttribute('href', new RegExp(`^/app/review/${projectId}\\?url=.*&comment=comment_`));

    // Delete (admin)
    await anaCard.getByRole('button', { name: /More actions/ }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('article', { name: 'Comment by Ana' })).toHaveCount(0);

    // Usage in the settings
    await page.goto(`/app/projects/${projectId}/settings`);
    const usage = page.getByRole('region', { name: 'Usage' });
    await expect(usage).toContainText(/Comments\s*1/);
    await expect(usage).toContainText(/Pages with comments\s*1/);

    // The link to Ben's comment opens the page with its thread
    await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(`${siteOrigin()}/${projectId}/about`)}&comment=${benComment.id}`);
    await expect(openThread(page)).toContainText('Team photo is blurry.');
});

test('feedback and bug reports from the toolbar reach the project', async ({ page, request }) => {
    const projectId = await ownerWithProject(page);
    await setAccess(page, projectId, 'Anyone with the link');
    const headers = { Origin: siteOrigin(), 'X-Uier-Visitor': randomBytes(32).toString('base64url') };

    // About the whole page: a `page` position and a kind
    const report = await request.post(`/api/review/${projectId}/comments`, {
        headers,
        data: { path: `/${projectId}/checkout`, position: { type: 'page' }, kind: 'bug', text: 'Pay button does nothing.', authorName: 'Dana' }
    });
    expect(report.status()).toBe(201);
    expect(await report.json()).toMatchObject({ kind: 'bug', position: { type: 'page' } });

    // A comment must still be pinned
    const unpinned = await request.post(`/api/review/${projectId}/comments`, {
        headers,
        data: { path: '/', position: { type: 'page' }, text: 'Hi', authorName: 'Dana' }
    });
    expect(unpinned.status()).toBe(400);

    await page.goto(`/app/projects/${projectId}`);
    const card = page.getByRole('article', { name: 'Comment by Dana' });
    await expect(card).toContainText('Bug report');
    await expect(card).toContainText('Pay button does nothing.');
});
