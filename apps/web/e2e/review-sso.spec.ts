import { expect, test } from '@playwright/test';
import { createProject, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { commentBubble, openThread, toolbar } from './support/toolbar';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(baseURL!); });
test.afterAll(async () => { await site.close(); });

test('a signed-in member starts reviewing in the background, and sign-out and exit are respected', async ({ page, context, baseURL }) => {
    await signIn(page, uniqueEmail('sso'));
    const project = await createProject(page, { urls: [site.origin()] });
    const url = `${site.origin()}/${project}/pricing`;
    const navigations: string[] = [];
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
    await page.goto(url);
    await expect(page.getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
    expect(navigations).toEqual([url]);
    expect(page.url()).toBe(url);
    await expect(page.locator('iframe[title="uier background sign-in"]')).toHaveCount(0);
    // Review API identity is a member; the app's own cookie is never sent to the host.
    expect((await context.cookies(site.origin())).some(cookie => cookie.name.startsWith('uier_'))).toBe(false);
    await page.getByRole('button', { name: 'Add comment', exact: true }).click();
    const heading = await page.getByRole('heading', { level: 1 }).boundingBox();
    await page.mouse.click(heading!.x + 20, heading!.y + heading!.height / 2);
    await page.getByRole('textbox', { name: 'Comment', exact: true }).fill('Signed in automatically.');
    await page.getByRole('textbox', { name: 'Comment', exact: true }).press('Enter');
    await expect(commentBubble(page, 1)).toBeVisible();
    await expect(openThread(page).getByText('You', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Options', exact: true }).click();
    await page.getByRole('button', { name: 'Exit review', exact: true }).click();
    await expect(toolbar(page)).toHaveCount(0);
    await page.reload();
    await expect(toolbar(page)).toHaveCount(0);
    // An explicit review link starts it again.
    await page.goto(`${url}?toolbar-code=${project}`);
    await expect(page.getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Options', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out...', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(toolbar(page)).toContainText('Sign in to see and leave comments.');
    await page.reload();
    await expect(toolbar(page)).toContainText('Sign in to see and leave comments.');
    // An invalid code must not override the reviewer's explicit background-sign-in opt-out.
    await page.goto(`${url}?toolbar-code=${project}&uier-token=${'x'.repeat(43)}`);
    await expect(toolbar(page)).toContainText('Sign in to see and leave comments.');
    // Explicit authentication overrides the opt-out, without another app login.
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
    expect(page.url()).not.toContain('uier-token');
    expect(page.url()).not.toContain(baseURL!);
});

test('blocked cookies leave ordinary visitors alone and preserve explicit sign-in', async ({ page }) => {
    await signIn(page, uniqueEmail('blocked-cookies'));
    const project = await createProject(page, { urls: [site.origin()] });
    // Leave the app before clearing the handoff cookie so pending app prefetches cannot
    // restore it. The Lax app cookie remains; the cross-site handoff has no credential.
    await page.goto('about:blank');
    await page.context().clearCookies({ name: 'uier_review_sso' });
    // App navigation can still seed a companion in a streamed response. Model a browser
    // refusing that cookie on this cross-site request even if a late response restores it.
    await page.route(`**/api/review/${project}/sso`, async route => {
        const headers = await route.request().allHeaders();
        headers.cookie = (headers.cookie ?? '').split(';').filter(cookie => !cookie.trim().startsWith('uier_review_sso=')).join(';');
        const response = await route.fetch({ headers });
        await route.fulfill({ response });
    });
    const attempted = page.waitForResponse(response => response.url().endsWith(`/api/review/${project}/sso`));
    await page.goto(`${site.origin()}/${project}/pricing`);
    expect((await attempted).status()).toBe(204);
    await expect(page.locator('iframe[title="uier background sign-in"]')).toHaveCount(0);
    await expect(toolbar(page)).toHaveCount(0);
    await page.goto(`${site.origin()}/${project}/pricing?toolbar-code=${project}`);
    await expect(toolbar(page)).toContainText('Sign in to see and leave comments.');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
});

test('background sign-in rejects messages from another source or with the wrong nonce', async ({ page, baseURL }) => {
    await signIn(page, uniqueEmail('spoof'));
    const project = await createProject(page, { urls: [site.origin()] });
    await page.addInitScript(() => {
        window.addEventListener('message', event => {
            if (event.data?.type === 'test:challenge') {
                // Even an event claiming the trusted origin cannot come from this window.
                window.dispatchEvent(new MessageEvent('message', {
                    origin: event.origin, source: window,
                    data: { type: 'uier:session-result', id: event.data.id, token: event.data.token }
                }));
            }
        });
    });
    await page.route('**/review-session', route => route.fulfill({
        contentType: 'text/html', body: `<script>
        window.addEventListener('message', event => {
            const token = 'e30.' + '0'.repeat(64);
            parent.postMessage({ type: 'uier:session-result', id: 'wrong-nonce', token }, event.origin);
            parent.postMessage({ type: 'test:challenge', id: event.data.id, token }, event.origin);
        });
        parent.postMessage({ type: 'uier:session-ready' }, '*');
        </script>`
    }));
    await page.goto(`${site.origin()}/${project}/pricing?toolbar-code=${project}`);
    await expect(toolbar(page)).toContainText('Sign in to see and leave comments.');
    expect(await page.evaluate(id => localStorage.getItem(`uier:review-token:${id}`), project)).toBeNull();
    expect(page.url()).not.toContain(baseURL!);
});

test('blocked background authentication falls back to the existing review link', async ({ page }) => {
    await signIn(page, uniqueEmail('sso-blocked'));
    const project = await createProject(page, { urls: [site.origin()] });
    await page.route('**/review-session', route => route.abort());
    await page.goto(`${site.origin()}/${project}/pricing?toolbar-code=${project}`);
    await expect(toolbar(page)).toContainText('Sign in to see and leave comments.');
    await expect(page.locator('iframe[title="uier background sign-in"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
});

test('pending review codes survive a host authentication redirect', async ({ page }) => {
    await signIn(page, uniqueEmail('redirect'));
    const project = await createProject(page, { urls: [site.origin()] });
    await page.route('**/review-session', route => route.abort());
    let redirected = false;
    // Reproduce a host SSO navigation while browser verification is in progress, before exchange.
    page.on('request', request => {
        if (!redirected && request.url().endsWith('/review-verification')) {
            redirected = true;
            void page.goto(`${site.origin()}/${project}/returned?toolbar-code=${project}`).catch(() => {});
        }
    });
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${site.origin()}/${project}/pricing`)}`).catch(() => {});
    await expect(page.getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
    expect(redirected).toBe(true);
    await expect(page).toHaveURL(`${site.origin()}/${project}/returned?toolbar-code=${project}`);
    expect(await page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith('uier:review-code:')))).toBe(false);
});

test('SSO requires the companion cookie, current membership, a configured parent and same-origin transport', async ({ page, context, baseURL }) => {
    await signIn(page, uniqueEmail('sso-security'));
    const project = await createProject(page, { urls: [site.origin()] });
    const endpoint = `/api/review/${project}/sso`;
    const headers = { Origin: new URL(baseURL!).origin };
    const data = { origin: site.origin() };
    const response = await context.request.post(endpoint, { headers, data });
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    const token = (await response.json()).token;
    const info = await context.request.get(`/api/review/${project}`, { headers: { Authorization: `Bearer ${token}` } });
    expect((await info.json()).viewer.kind).toBe('member');
    const invalidRequests: { headers: Record<string, string>; data: { origin: string } }[] = [
        { headers: {}, data },
        { headers: { Origin: site.origin() }, data },
        { headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' }, data },
        { headers, data: { origin: 'https://unconfigured.example' } }
    ];
    for (const invalid of invalidRequests) {
        const denied = await context.request.post(endpoint, invalid);
        expect(denied.status()).toBe(403);
        expect(denied.headers()['access-control-allow-origin']).toBeUndefined();
    }
    // An existing app login is upgraded on its next first-party app visit.
    await context.clearCookies({ name: 'uier_review_sso' });
    expect((await context.request.post(endpoint, { headers, data })).status()).toBe(204);
    await page.goto('/app/projects');
    expect((await context.request.post(endpoint, { headers, data })).status()).toBe(200);
    // Another signed-in account cannot use this project's background handoff.
    await context.clearCookies();
    await signIn(page, uniqueEmail('no-project-access'));
    expect((await context.request.post(endpoint, { headers, data })).status()).toBe(204);
    await page.goto(`${site.origin()}/${project}/pricing?toolbar-code=${project}`);
    await expect(toolbar(page)).toContainText('Sign in to see and leave comments.');
});
