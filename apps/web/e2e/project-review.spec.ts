import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Browser, Page, TestInfo } from '@playwright/test';
import { startReviewedSite } from './support/reviewedSite';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { expectNoAxeViolations } from './accessibility';
import { createProject, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { chooseInboxPages, commentBubble, commentBubbles, newVisitor, showcaseHint, animationsFinished, dismissFirstRunHint, openThread, selectText, selectionToolbar, toolbar } from './support/toolbar';
import { pngImage } from './support/images';

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
    await expect(showcaseHint(stranger.page)).toHaveCount(0);
    await expect(stranger.page.getByRole('button', { name: 'About uier' })).toHaveCount(0);
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

test('a schemeless localhost address opens an HTTP review and accepts feedback only on its configured origin', async ({ page }) => {
    await signIn(page, uniqueEmail('localhost'));
    const origin = `http://localhost:${sitePort}`;
    const projectId = await createProject(page, { urls: [`localhost:${sitePort}`], name: 'Local development' });
    await page.goto(`/app/projects/${projectId}/settings`);
    const addresses = page.getByRole('region', { name: 'Site addresses' });
    await expect(addresses.getByLabel('Main site address')).toHaveValue(origin);

    // Saving a local path keeps its HTTP scheme after a reload.
    await addresses.getByLabel('Main site address').fill(`localhost:${sitePort}/${projectId}/pricing/`);
    await addresses.getByRole('button', { name: 'Save' }).click();
    await expect(addresses.getByRole('status')).toHaveText('The addresses are saved.');
    await page.reload();
    await expect(addresses.getByLabel('Main site address')).toHaveValue(`${origin}/${projectId}/pricing`);

    const apiPath = `/api/review/${projectId}`;
    const allowed = await page.request.get(apiPath, { headers: { Origin: origin } });
    expect(allowed.status()).toBe(200);
    expect(allowed.headers()['access-control-allow-origin']).toBe(origin);
    for (const otherOrigin of [`http://localhost:${sitePort === 65535 ? 65534 : sitePort + 1}`, `https://localhost:${sitePort}`]) {
        const rejected = await page.request.get(apiPath, { headers: { Origin: otherOrigin } });
        expect(rejected.status()).toBe(403);
        expect(rejected.headers()['access-control-allow-origin']).toBeUndefined();
    }

    await page.goto(`/app/review/${projectId}`);
    await expect(page).toHaveURL(`${origin}/${projectId}/pricing?toolbar-code=${projectId}`);
    await addPointComment(page, 'Feedback from localhost.');
    await page.reload();
    await expect(commentBubble(page, 1)).toBeVisible();
    await page.goto(`/app/projects/${projectId}`);
    await expect(page.getByRole('article', { name: 'Comment by you' })).toContainText('Feedback from localhost.');
});

test('guest mode: anyone with the link comments under their name', async ({ page, browser }, testInfo) => {
    const projectId = await ownerWithProject(page);
    await setProjectAccess(page, projectId, 'Anyone with the link');
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
    await setProjectAccess(page, projectId, 'Anyone with the link');
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

test('a screenshot with a comment on the project\'s site, shown in the toolbar and the app', async ({ page, request, browser }, testInfo) => {
    const projectId = await ownerWithProject(page);
    await setProjectAccess(page, projectId, 'Anyone with the link');

    // The guest takes it with the comment; the site's CSP (the install guide's sources) allows it
    const guest = await anonymousVisitor(browser, testInfo);
    const violations = await watchCsp(guest.page);
    await guest.page.goto(`${siteOrigin()}/${projectId}/pricing?toolbar-code=${projectId}`);
    await guest.page.getByRole('button', { name: 'Add comment' }).click();
    const heading = await guest.page.getByRole('heading', { level: 1 }).boundingBox();
    await guest.page.mouse.click(heading!.x + 20, heading!.y + heading!.height / 2);
    const draft = guest.page.getByRole('dialog', { name: 'New comment' });
    await draft.getByRole('textbox', { name: 'Your name' }).fill('Dana');
    await draft.getByRole('textbox', { name: 'Comment' }).fill('The price is hard to find.');
    await expect(draft.getByRole('img')).toHaveCount(0);
    await draft.getByRole('button', { name: 'Post comment' }).click();

    // The thread fetches it from the review API (with the reviewer's headers, as a data: image)
    const shown = openThread(guest.page).getByRole('button', { name: 'Screenshot of the commented part of the page' });
    await expect(shown).toBeVisible();
    await expect.poll(async () => await shown.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    // Supplying evidence reuses the cross-origin verification/CORS path and the guest's identity.
    await openThread(guest.page).getByLabel('Upload screenshot image').setInputFiles({
        name: 'supplied.png', mimeType: 'image/png', buffer: Buffer.from(pngImage.split(',')[1]!, 'base64')
    });
    await expect(openThread(guest.page).getByRole('status')).toContainText('Screenshot replaced.');
    await expect.poll(async () => await shown.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(3);
    expect(violations).toEqual([]);
    await guest.context.close();

    // The review API serves it to the project's sites only
    const headers = await verifiedReviewHeaders(request, projectId, siteOrigin());
    const [comment] = await (await request.get(`/api/review/${projectId}/comments?path=/${projectId}/pricing`, { headers })).json() as { id: string; screenshot?: { width: number; height: number } }[];
    expect(comment!.screenshot?.width).toBeGreaterThan(0);
    const image = await request.get(`/api/review/${projectId}/comments/${comment!.id}/screenshot`, { headers });
    expect(image.status()).toBe(200);
    expect(image.headers()['content-type']).toBe('image/png');
    expect(image.headers()['access-control-allow-origin']).toBe(siteOrigin());
    expect((await request.get(`/api/review/${projectId}/comments/${comment!.id}/screenshot`, { headers: { ...headers, Origin: siteOrigin('elsewhere') } })).status()).toBe(403);
    const imageUrl = `/api/review/${projectId}/comments/${comment!.id}/screenshot`;
    const data = { screenshot: pngImage, expectedRevision: null };
    expect((await request.post(imageUrl, { headers, data })).status()).toBe(403); // another guest
    expect((await request.post(imageUrl, { headers: { ...headers, Origin: siteOrigin('elsewhere') }, data })).status()).toBe(403);
    const preflight = await request.fetch(imageUrl, { method: 'OPTIONS', headers: { Origin: siteOrigin(), 'Access-Control-Request-Method': 'POST' } });
    expect(preflight.headers()['access-control-allow-methods']).toContain('POST');

    // The app shows it on the comment, and opens it full size
    await page.goto(`/app/projects/${projectId}`);
    const card = page.getByRole('article', { name: 'Comment by Dana' });
    const appImage = card.getByRole('img', { name: 'Screenshot of the commented part of the page' });
    await expect(appImage).toBeVisible();
    await expect.poll(async () => await appImage.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(comment!.screenshot!.width);
    const thumbnail = card.getByRole('button', { name: 'Screenshot of the commented part of the page' });
    expect((await thumbnail.boundingBox())!.width).toBeLessThanOrEqual(100);
    await thumbnail.click();
    const expanded = page.getByRole('dialog', { name: 'Screenshot', exact: true });
    await expect(expanded.getByRole('img', { name: 'Expanded screenshot' })).toBeVisible();
    await expectNoAxeViolations(page);
    await expanded.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(expanded).toBeHidden();
    await expect(thumbnail).toBeFocused();
});

test('guest edits and original reproduction details persist; only members see and copy the details', async ({ page, browser, request }, testInfo) => {
    const projectId = await ownerWithProject(page);
    await setProjectAccess(page, projectId, 'Anyone with the link');
    const guest = await anonymousVisitor(browser, testInfo);
    await guest.page.addInitScript(() => Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: {
        brands: [{ brand: 'Not_A Brand', version: '99' }, { brand: 'Chromium', version: '123' }, { brand: 'Example Browser', version: '123' }], platform: 'Example OS'
    } }));
    const path = `/${projectId}/pricing`;
    await guest.page.goto(`${siteOrigin()}${path}?toolbar-code=${projectId}&session_token=never-copy-this#private`);
    const originalViewport = await guest.page.evaluate(() => [innerWidth, innerHeight]);
    await guest.page.getByRole('button', { name: 'Add comment' }).click();
    const heading = (await guest.page.getByRole('heading', { level: 1 }).boundingBox())!;
    await guest.page.mouse.click(heading.x + 20, heading.y + heading.height / 2);
    const draft = guest.page.getByRole('dialog', { name: 'New comment' });
    await draft.getByRole('textbox', { name: 'Your name' }).fill('Context reviewer');
    await guest.page.setViewportSize({ width: 360, height: 680 });
    await draft.getByRole('textbox', { name: 'Comment', exact: true }).fill('Original report.');
    const posted = guest.page.waitForResponse(response => new URL(response.url()).pathname === `/api/review/${projectId}/comments` && response.request().method() === 'POST');
    await draft.getByRole('button', { name: 'Post comment' }).click();
    const response = await posted;
    const sent = response.request().postDataJSON();
    expect(sent.device.windowSize).toEqual(originalViewport);
    expect(sent.device.browser).toBe('Example Browser (123)');
    expect(sent.device.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const savedComment = await response.json();
    expect(savedComment.reproduction).toBeUndefined();
    const forbidden = await request.patch(`/api/review/${projectId}/comments/${savedComment.id}/replies/${savedComment.thread.items[0].id}`, {
        headers: await verifiedReviewHeaders(request, projectId, siteOrigin(), randomBytes(32).toString('base64url')),
        data: { text: 'An unrelated guest cannot edit this', expectedText: 'Original report.' }
    });
    expect(forbidden.status()).toBe(403);
    const guestThread = openThread(guest.page);
    // Guests see the device, never the member-only reproduction details
    await guestThread.getByRole('button', { name: /^Device:/ }).click();
    await expect(guestThread.getByRole('button', { name: 'Copy reproduction details' })).toHaveCount(0);
    await guestThread.getByRole('textbox', { name: 'Reply', exact: true }).fill('Original reply.');
    await guestThread.getByRole('button', { name: 'Post reply', exact: true }).click();
    await guestThread.getByRole('button', { name: 'More options for your reply' }).click();
    await guest.page.getByRole('dialog', { name: 'Reply options', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click();
    await guestThread.getByRole('textbox', { name: 'Edit reply', exact: true }).fill('Corrected guest reply.');
    await guestThread.getByRole('button', { name: 'Save changes' }).click();
    await expect(guestThread).toContainText('Corrected guest reply. (edited)');
    await guest.context.close();

    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => {
        (window as Window & { copiedContext?: string }).copiedContext = text;
    } } }));
    await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(`${siteOrigin()}${path}?session_token=never-copy-this#private`)}`);
    await page.locator('[data-uier-comment]').click();
    const thread = openThread(page);
    // The device icon names the browser; a click shows it with the reproduction details
    const device = thread.getByRole('button', { name: /^Device:/ });
    await expect(device).toHaveAccessibleName(/Example Browser \(123\) · Example OS/);
    await device.click();
    await expect(thread).toContainText('Example Browser (123) · Example OS');
    await expect(thread.getByRole('link', { name: 'Reviewed page' })).toHaveAttribute('href', `${siteOrigin()}${path}`);
    await thread.getByRole('button', { name: 'Copy reproduction details', exact: true }).click();
    const copied = await page.evaluate(() => (window as Window & { copiedContext?: string }).copiedContext);
    expect(copied).toContain(`Viewport: ${originalViewport[0]}×${originalViewport[1]} CSS px`);
    expect(copied).toContain(`Captured: ${sent.device.capturedAt}`);
    expect(copied).not.toMatch(/never-copy-this|toolbar-code|uier-token|session_token|#private/);
    await thread.getByRole('button', { name: 'More options for this comment' }).click();
    await page.getByRole('dialog', { name: 'Comment options', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click();
    await thread.getByRole('textbox', { name: 'Edit comment', exact: true }).fill('Admin clarified the report.');
    await thread.getByRole('button', { name: 'Save changes' }).click();
    await expect(thread).toContainText('Admin clarified the report. (edited)');
    await page.reload();
    await page.locator('[data-uier-comment]').click();
    await openThread(page).getByRole('button', { name: /^Device:/ }).click();
    await openThread(page).getByRole('button', { name: 'Copy reproduction details', exact: true }).click();
    expect(await page.evaluate(() => (window as Window & { copiedContext?: string }).copiedContext)).toBe(copied);

    await page.goto(`/app/projects/${projectId}`);
    const card = page.getByRole('article', { name: 'Comment by Context reviewer' });
    await expect(card).toContainText('Admin clarified the report. (edited)');
    await card.getByRole('button', { name: '1 reply' }).click();
    await expect(card).toContainText('Corrected guest reply. (edited)');
    await card.getByRole('button', { name: 'Reproduction details', exact: true }).click();
    await expect(card.locator('pre')).toHaveText(copied!);
    await card.getByRole('button', { name: 'Copy reproduction details', exact: true }).click();
    expect(await page.evaluate(() => (window as Window & { copiedContext?: string }).copiedContext)).toBe(copied);
    await expectNoAxeViolations(page);
});

for (const layout of ['html-scroll', 'body-hidden']) {
    test(`a screenshot far down a long page is not blank (${layout})`, async ({ page, browser }, testInfo) => {
        const projectId = await ownerWithProject(page);
        await setProjectAccess(page, projectId, 'Anyone with the link');

        // CSS that turns a copy of the page into a clipped box, and a lazy image that never loads
        const guest = await anonymousVisitor(browser, testInfo);
        await guest.page.goto(`${siteOrigin()}/${projectId}/long?toolbar-code=${projectId}&layout=${layout}`);
        await expect(guest.page.getByRole('button', { name: 'Add comment' })).toBeVisible();
        const row = guest.page.locator('#row-30');
        await row.scrollIntoViewIfNeeded();
        expect(await guest.page.evaluate(() => window.scrollY)).toBeGreaterThan(await guest.page.evaluate(() => window.innerHeight));
        await guest.page.getByRole('button', { name: 'Add comment' }).click();
        const box = await row.boundingBox();
        await guest.page.mouse.click(box!.x + 20, box!.y + box!.height / 2);
        const draft = guest.page.getByRole('dialog', { name: 'New comment' });
        await draft.getByRole('textbox', { name: 'Your name' }).fill('Dana');
        await draft.getByRole('textbox', { name: 'Comment' }).fill('Row 30 says it twice.');

        // Without waiting for the lazy image
        const started = Date.now();
        await draft.getByRole('button', { name: 'Post comment' }).click();
        const savedThread = guest.page.getByRole('dialog', { name: 'Comment thread' });
        await savedThread.getByRole('region', { name: 'Screenshot evidence' }).scrollIntoViewIfNeeded();
        const preview = savedThread.getByRole('img', { name: 'Screenshot of the commented part of the page' });
        await expect(preview).toBeVisible();
        expect(Date.now() - started).toBeLessThan(5_000);

        // The row's text is in it (dark pixels on the white page)
        const ink = await preview.evaluate(async (img: HTMLImageElement) => {
            await img.decode();
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const context = canvas.getContext('2d')!;
            context.drawImage(img, 0, 0);
            const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
            let dark = 0;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i]! + data[i + 1]! + data[i + 2]! < 300) {
                    dark++;
                }
            }
            return dark / (data.length / 4);
        });
        expect(ink).toBeGreaterThan(0.005);
        await guest.context.close();
    });
}

test('comments off: the toolbar says so and the API refuses', async ({ page, request }) => {
    const projectId = await ownerWithProject(page);
    await setProjectAccess(page, projectId, 'Comments off');

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
    await setProjectAccess(page, projectId, 'Anyone with the link');

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
    await setProjectAccess(page, projectId, 'Anyone with the link');

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
    const headers = await verifiedReviewHeaders(request, projectId, siteOrigin());
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
    expect((await suggest({ text: 'Hi' }, { Origin: siteOrigin() })).status()).toBe(403);
    expect((await suggest({ text: 'Hi' }, { ...headers, Origin: siteOrigin('elsewhere') })).status()).toBe(403);
    const preflight = await request.fetch(`/api/review/${projectId}/rewrite`, {
        method: 'OPTIONS',
        headers: { Origin: siteOrigin(), 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-uier-visitor' }
    });
    expect(preflight.headers()['access-control-allow-methods']).toBe('POST');

    await setProjectAccess(page, projectId, 'Comments off');
    const off = await suggest({ text: 'Hi' });
    expect(off.status()).toBe(403);
    expect((await off.json()).error).toBe('comments_disabled');
});

test('the toolbar\'s inbox lists the project\'s other pages; comments have public ids', async ({ page, request, browser }, testInfo) => {
    const projectId = await ownerWithProject(page);
    await setProjectAccess(page, projectId, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, projectId, siteOrigin());
    const post = async (path: string, text: string) => {
        const response = await request.post(`/api/review/${projectId}/comments`, {
            headers,
            data: { path, position: { type: 'point', selector: 'body>main>h1', xNormal: 0.5, yNormal: 0.5 }, text, authorName: 'Dana' }
        });
        expect(response.status()).toBe(201);
        return await response.json() as { id: string; number: number };
    };
    const pricing = await post(`/${projectId}/pricing`, 'Show yearly prices.');
    const checkout = await post(`/${projectId}/checkout`, 'The pay button is hidden.');
    expect([pricing.number, checkout.number]).toEqual([1, 2]);
    // The numbers' sequence document is in the project's partition too, out of reach
    const sequence = await request.patch(`/api/review/${projectId}/comments/${encodeURIComponent('$sequence_comments')}`, { headers, data: { resolved: true } });
    expect(sequence.status()).toBe(404);

    // Every page of the project, newest first
    const site = await request.get(`/api/review/${projectId}/comments?scope=site`, { headers });
    expect(site.status()).toBe(200);
    expect((await site.json() as { number: number; path: string }[]).map(c => [c.number, c.path])).toEqual([
        [2, `/${projectId}/checkout`],
        [1, `/${projectId}/pricing`]
    ]);

    // The toolbar on the pricing page: this page, and the checkout page in the page picker
    const guest = await anonymousVisitor(browser, testInfo);
    await guest.page.goto(`${siteOrigin()}/${projectId}/pricing?toolbar-code=${projectId}`);
    await guest.page.getByRole('button', { name: /^Inbox(?:,|$)/ }).click();
    const sidebar = guest.page.getByRole('complementary', { name: 'Comments' });
    await expect(sidebar.getByRole('region', { name: 'This page' }).getByRole('article', { name: 'Comment #1' })).toContainText('Show yearly prices.');
    await chooseInboxPages(guest.page, new RegExp(`^/${projectId}/checkout`));
    const other = sidebar.getByRole('region', { name: `/${projectId}/checkout` }).getByRole('article', { name: 'Comment #2' });
    await expect(other).toContainText('The pay button is hidden.');
    await expect(other.getByRole('link', { name: `Open on /${projectId}/checkout` }))
        .toHaveAttribute('href', `${siteOrigin()}/${projectId}/checkout?toolbar-code=${projectId}&uier-comment=${checkout.id}`);
    await guest.context.close();

    // The app shows the same ids
    await page.goto(`/app/projects/${projectId}`);
    await expect(page.getByRole('article', { name: 'Comment by Dana' }).filter({ hasText: 'The pay button is hidden.' })).toContainText('Comment #2');
});

test('the app lists, filters and manages a project\'s comments', async ({ page, request }) => {
    const projectId = await ownerWithProject(page);
    await setProjectAccess(page, projectId, 'Anyone with the link');

    // Two guests comment on two pages (through the review API, like their toolbar does)
    const guest = (name: string) => ({ token: randomBytes(32).toString('base64url'), name });
    const ana = guest('Ana');
    const ben = guest('Ben');
    const post = async (author: { token: string; name: string }, path: string, text: string, device: 'desktop' | 'mobile') => {
        const response = await request.post(`/api/review/${projectId}/comments`, {
            headers: await verifiedReviewHeaders(request, projectId, siteOrigin(), author.token),
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
    expect((await list(ana, about))[0]!.permissions).toEqual({ resolve: false, delete: false, edit: false, assign: false });
    expect((await list(ben, about))[0]!.permissions).toEqual({ resolve: true, delete: true, edit: true, assign: false });

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
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
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
    await setProjectAccess(page, projectId, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, projectId, siteOrigin());

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

for (const colorScheme of ['light', 'dark'] as const) {
    test(`first-run guide and plain-text review brief follow project access (${colorScheme})`, async ({ page, browser, request, baseURL }, testInfo) => {
        const first = await ownerWithProject(page);
        const brief = '<b>Review pricing</b>\n[Checkout](https://example.com)\nhttps://example.com';
        await page.goto(`/app/projects/${first}/settings`);
        const settings = page.getByRole('region', { name: 'Review brief', exact: true });
        await settings.getByLabel('Review instructions').fill(brief);
        await settings.getByRole('button', { name: 'Save' }).click();
        await expect(settings.getByRole('status')).toContainText('The review brief is saved.');
        const signedOutInfo = await request.get(`/api/review/${first}`, { headers: { Origin: siteOrigin() } });
        expect((await signedOutInfo.json()).project).not.toHaveProperty('brief');

        await page.emulateMedia({ colorScheme });
        await page.goto(`/app/review/${first}?url=${encodeURIComponent(`${siteOrigin()}/${first}/pricing`)}`);
        const invitedHint = showcaseHint(page);
        await expect(invitedHint).toContainText('Only invited people can see and leave comments. Some comments may be private.');
        await expect(invitedHint).toContainText(brief);
        await expect(invitedHint).not.toContainText('90 days');
        await expect(invitedHint.locator('b, a')).toHaveCount(0);
        await animationsFinished(invitedHint);
        await expectNoAxeViolations(page);
        await dismissFirstRunHint(page);

        await setProjectAccess(page, first, 'Anyone with the link');
        const second = await createProject(page, { urls: [siteOrigin()], name: 'Another review' });
        await setProjectAccess(page, second, 'Anyone with the link');
        const guest = await anonymousVisitor(browser, testInfo);
        try {
            await guest.page.emulateMedia({ colorScheme });
            await guest.page.goto(`${siteOrigin()}/${first}/pricing?toolbar-code=${first}`);
            const hint = showcaseHint(guest.page);
            await expect(hint).toContainText('Anyone with the review link can see and leave comments. Some comments may be private.');
            await expect(hint).toContainText(brief);
            await expect(hint.locator('b, a')).toHaveCount(0);
            await expect(hint).not.toContainText('90 days');
            expect(await hint.locator('p').last().evaluate(element => getComputedStyle(element).whiteSpace)).toBe('pre-wrap');
            await animationsFinished(hint);
            await expect.poll(async () => {
                const arrow = await hint.locator(':scope > span[aria-hidden="true"]').boundingBox();
                const add = await guest.page.getByRole('button', { name: 'Add comment' }).boundingBox();
                return arrow && add ? Math.abs(arrow.x + arrow.width / 2 - add.x - add.width / 2) : Infinity;
            }).toBeLessThan(2);
            await expectNoAxeViolations(guest.page);
            await guest.page.screenshot({ path: testInfo.outputPath(`review-guide-${colorScheme}.png`) });
            await dismissFirstRunHint(guest.page);
            const key = `uier:hint:v1:${new URL(baseURL!).origin}:${first}`;
            expect(await guest.page.evaluate(key => localStorage.getItem(key), key)).toBe('true');
            await guest.page.reload();
            await expect(toolbar(guest.page)).toBeVisible();
            await expect(hint).toHaveCount(0);
            await guest.page.getByRole('button', { name: /^Inbox/ }).click();
            const inbox = guest.page.getByRole('complementary', { name: 'Comments' });
            await inbox.getByRole('button', { name: 'Review brief' }).click();
            const shown = inbox.getByRole('region', { name: 'Review brief' });
            await expect(shown).toHaveText(brief);
            await expect(shown.locator('b, a')).toHaveCount(0);
            await inbox.getByRole('button', { name: 'Review brief' }).click();
            await expect(shown).toHaveCount(0);

            // Dismissal is scoped to a project even on the same site, and starting a comment persists it.
            await guest.page.goto(`${siteOrigin()}/${second}/pricing?toolbar-code=${second}`);
            await expect(hint).toBeVisible();
            await guest.page.getByRole('button', { name: 'Add comment' }).click();
            await expect(hint).toHaveCount(0);
            await guest.page.reload();
            await expect(toolbar(guest.page)).toBeVisible();
            await expect(hint).toHaveCount(0);
            await guest.page.getByRole('button', { name: /^Inbox/ }).click();
            await expect(inbox.getByRole('button', { name: 'Review brief' })).toHaveCount(0);

            await setProjectAccess(page, first, 'Comments off');
            const offInfo = await request.get(`/api/review/${first}`, { headers: { Origin: siteOrigin() } });
            expect((await offInfo.json()).project).not.toHaveProperty('brief');
            await guest.page.goto(`${siteOrigin()}/${first}/pricing?toolbar-code=${first}`);
            await expect(toolbar(guest.page)).toContainText('Comments are turned off');
            await expect(hint).toHaveCount(0);
            await expect(guest.page.getByRole('button', { name: 'About uier' })).toHaveCount(0);
        } finally { await guest.context.close(); }
    });
}
