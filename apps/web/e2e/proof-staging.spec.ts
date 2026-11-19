import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { expect, test } from '@playwright/test';
import { cspSources, embedScript } from '../src/lib/app/integration';
import { proofViewerPath, type ProofAsset, type ProofUploadGrant, type ProofVersion } from '../src/lib/proofs/model';
import { createProject, enableProjectVerification, hydrated, projectPublicId, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { openThread, threadOptions, toolbar } from './support/toolbar';
import { pasteFile } from './support/images';

test('approved PDF page overlays a top-level staging site, links a discrepancy and verifies actual before and after evidence', async ({ page, browser, baseURL, isMobile }) => {
    test.setTimeout(120_000);
    let project = '';
    let fixed = false;
    const csp = ['default-src \'self\'', "frame-ancestors 'none'",
        ...cspSources(baseURL!).map(({ directive, sources }) => `${directive} 'self' ${sources.join(' ')}`)].join('; ');
    const server = createServer((request, response) => {
        if (request.url?.startsWith('/staging.css')) {
            response.writeHead(200, { 'Content-Type': 'text/css' });
            response.end('body{margin:0;background:white}h1{margin:0;padding:24px;font:32px sans-serif} main{min-height:150vh}');
            return;
        }
        response.writeHead(200, { 'Content-Type': 'text/html', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': csp });
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Staging checkout</title><link rel="stylesheet" href="/staging.css"><body><main><h1>${fixed ? 'Shipping confirmed' : 'Shipping pending'}</h1></main>
${embedScript(baseURL!, project)}</body></html>`);
    });
    await new Promise<void>(resolve => server.listen(0, resolve));
    const staging = `http://staging-proof.localhost:${(server.address() as AddressInfo).port}/checkout`;
    const reviewerContext = await browser.newContext({ baseURL, viewport: page.viewportSize(), isMobile, hasTouch: isMobile });
    const guestContext = await browser.newContext({ baseURL, viewport: page.viewportSize(), isMobile, hasTouch: isMobile });
    try {
        const ownerEmail = uniqueEmail('staging-owner');
        await signIn(page, ownerEmail);
        const internal = await createProject(page, { urls: [staging], name: 'Staging approval' });
        project = await projectPublicId(page, internal);
        await enableProjectVerification(page, internal);
        await setProjectAccess(page, internal, 'Anyone with the link');
        const endpoint = `/api/proofs/${project}`;
        const headers = { Origin: baseURL! };
        const post = (path: string, data?: unknown) => page.request.post(endpoint + path, { headers, data });
        expect((await page.request.patch(`${endpoint}/settings`, { headers, data: { formats: ['image', 'pdf'] } })).ok()).toBe(true);
        const { asset } = await (await post('/assets', { name: 'Checkout design' })).json() as { asset: ProofAsset };
        const file = await PDFDocument.create();
        file.addPage([400, 500]);
        const expected = file.addPage([400, 500]);
        expected.drawText('Shipping confirmed', { x: 24, y: 448, size: 24, font: await file.embedFont(StandardFonts.Helvetica), color: rgb(0.1, 0.2, 0.3) });
        const bytes = Buffer.from(await file.save());
        const assetPath = `/assets/${asset.id}`;
        const upload = await post(assetPath + '/uploads', {
            requestId: randomUUID(), expectedVersionId: null, filename: 'Checkout.pdf', contentType: 'application/pdf', size: bytes.length
        });
        expect(upload.ok(), await upload.text()).toBe(true);
        const grant = await upload.json() as ProofUploadGrant;
        expect((await page.request.put(grant.uploadUrl!, { headers: { ...headers, ...grant.headers }, data: bytes })).ok()).toBe(true);
        const finalized = await post(`${assetPath}/uploads/${grant.version.id}/finalize`);
        expect(finalized.ok(), await finalized.text()).toBe(true);
        const { version } = await finalized.json() as { version: ProofVersion };
        const designPage = version.manifest!.surfaces[1]!.id;
        const options = await page.request.get(endpoint + assetPath + '/approvals?mode=options');
        const { members } = await options.json() as { members: { id: string; name: string }[] };
        expect(members).toHaveLength(1);
        const started = await post(assetPath + '/approvals', { versionId: version.id, requestId: randomUUID(),
            reviewers: [{ kind: 'member', userId: members[0]!.id, required: true }], deadline: null });
        expect(started.ok(), await started.text()).toBe(true);
        const approved = await post(assetPath + '/approvals?mode=decision', { versionId: version.id, requestId: randomUUID(),
            revision: 1, decisionRevision: 0, decision: 'approved' });
        expect(approved.ok(), await approved.text()).toBe(true);
        const viewer = proofViewerPath(project, asset.id, version.id);
        const guestPage = await guestContext.newPage();
        expect((await guestPage.request.get(endpoint + assetPath)).status()).toBe(404);

        const reviewerEmail = uniqueEmail('staging-reviewer');
        await page.goto('/app/users');
        const inviteButton = page.getByRole('button', { name: 'Invite', exact: true });
        await hydrated(inviteButton);
        await inviteButton.click();
        const invite = page.getByRole('dialog');
        await invite.getByLabel('Email').fill(reviewerEmail);
        await invite.getByRole('radio', { name: 'All projects, now and later' }).click();
        await invite.getByRole('button', { name: 'Send invitation' }).click();
        const invitation = invite.getByRole('link', { name: 'Open the invitation link' });
        await expect(invitation).toBeVisible();
        const reviewer = await reviewerContext.newPage();
        await reviewer.goto((await invitation.getAttribute('href'))!);
        const accept = reviewer.getByRole('button', { name: 'Accept invitation' });
        await hydrated(accept);
        await accept.click();
        await reviewer.waitForURL(url => !url.pathname.startsWith('/app/invitation'));

        await page.goto(viewer + '&' + new URLSearchParams({ surface: designPage }));
        const form = page.locator('details').filter({ has: page.getByText('Design to staging', { exact: true }) });
        await form.getByLabel('Staging page URL').fill(staging);
        const viewport = page.viewportSize()!;
        await form.getByLabel('Viewport width (px)').fill(String(viewport.width));
        await form.getByLabel('Viewport height (px)').fill(String(viewport.height));
        await form.getByRole('button', { name: 'Pair with staging' }).click();
        const launch = form.getByRole('link', { name: 'Open paired live review' });
        const openPath = (await launch.getAttribute('href'))!;
        const pairingId = openPath.split('/').at(-2)!;
        const stageResponse = page.waitForResponse(response => response.url().startsWith(staging) && response.request().isNavigationRequest());
        await launch.click();
        expect((await stageResponse).headers()['x-frame-options']).toBe('DENY');
        await expect(page.getByRole('heading', { name: 'Shipping pending' })).toBeVisible();
        const toggle = page.locator('[data-uier-staging-toggle]');
        if (isMobile) await toggle.tap(); else { await toggle.focus(); await toggle.press('Enter'); }
        const selector = 'iframe[title="Approved design preview"]';
        const frame = page.frameLocator(selector);
        const image = frame.getByRole('img', { name: 'Approved design preview' });
        const allow = frame.getByRole('link', { name: 'Authorize design preview in uier' });
        await expect(image.or(allow)).toBeVisible();
        if (await allow.isVisible()) {
            const event = page.context().waitForEvent('page');
            await allow.click();
            const authorization = await event;
            await authorization.getByRole('button', { name: 'Allow design preview' }).click();
            await expect(authorization.getByRole('status')).toContainText('Design preview authorized.');
            await authorization.close();
        }
        await expect(image).toBeVisible();
        await expect(page.getByRole('slider', { name: 'Design opacity' })).toBeVisible();
        expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(400);
        expect(await page.locator(selector).evaluate((iframe: HTMLIFrameElement) => iframe.contentDocument)).toBeNull();
        expect(await page.locator(selector).getAttribute('src')).not.toMatch(/token|challenge|blob:/);

        const report = page.locator('[data-uier-staging-report]');
        if (isMobile) await report.tap(); else await report.click();
        const title = page.getByRole('heading', { name: 'Shipping pending' });
        const box = (await title.boundingBox())!;
        if (isMobile) await page.touchscreen.tap(box.x + 35, box.y + box.height / 2);
        else await page.mouse.click(box.x + 35, box.y + box.height / 2);
        await expect(page.getByText('This comment links to the approved design.')).toBeVisible();
        const draft = page.getByRole('textbox', { name: 'Comment', exact: true });
        await draft.fill('Shipping uses the wrong heading.');
        const created = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/comments'));
        await page.getByRole('button', { name: 'Post comment', exact: true }).click();
        const creation = await created;
        expect(creation.status(), await creation.text()).toBe(201);
        const thread = await creation.json() as { id: string; number: number; screenshot?: unknown };
        expect(thread.screenshot).toBeDefined();
        const design = openThread(page).getByRole('link', { name: 'Approved design', exact: true });
        const designHref = (await design.getAttribute('href'))!;
        const guestOpen = await guestPage.request.get(openPath, { maxRedirects: 0 });
        expect(guestOpen.status()).toBe(404);
        expect((await guestPage.request.get(designHref, { maxRedirects: 0 })).status()).toBe(404);
        await guestPage.goto(staging + '?' + new URLSearchParams({ 'toolbar-code': project, 'uier-comment': thread.id, 'uier-design': pairingId }));
        await expect(openThread(guestPage)).toContainText('Shipping uses the wrong heading.');
        await expect(guestPage.locator('[data-uier-staging-toggle]')).toHaveCount(0);
        await expect(openThread(guestPage).getByRole('link', { name: 'Approved design', exact: true })).toHaveCount(0);

        fixed = true;
        await reviewer.goto(openPath + '?' + new URLSearchParams({ comment: thread.id }));
        await expect(toolbar(reviewer)).toBeVisible();
        const newTitle = reviewer.getByRole('heading', { name: 'Shipping confirmed' });
        await expect(newTitle).toBeVisible();
        const after = await newTitle.screenshot();
        const liveThread = openThread(reviewer);
        const reply = liveThread.getByRole('textbox', { name: 'Reply', exact: true });
        await reply.fill('Updated the heading on staging.');
        await pasteFile(reviewer, { buffer: after, name: 'after.png', mimeType: 'image/png' });
        await expect(liveThread.getByRole('button', { name: 'Remove attached image after.png' })).toBeVisible();
        await liveThread.getByRole('button', { name: 'Post reply', exact: true }).click();
        await expect(liveThread.getByRole('button', { name: 'Image attached to reply', exact: true })).toBeVisible();
        await (await threadOptions(reviewer, liveThread)).getByRole('button', { name: 'Request verification', exact: true }).click();
        const request = liveThread.getByRole('form', { name: 'Request verification' });
        await request.getByLabel('After screenshot').selectOption({ label: 'Reply screenshot 1' });
        await request.getByRole('button', { name: 'Original author', exact: true }).click();
        await request.getByRole('button', { name: 'Request verification', exact: true }).click();
        await expect(liveThread).toContainText('Before screenshot');
        await expect(liveThread).toContainText('After screenshot');

        await page.goto(designHref);
        await expect(page).toHaveURL(url => url.searchParams.get('version') === version.id && url.searchParams.get('surface') === designPage);
        const backlink = page.getByRole('link', { name: `Discrepancy #${thread.number}`, exact: true });
        await expect(backlink).toBeVisible();
        await backlink.click();
        const verification = openThread(page).getByRole('region', { name: 'Fix verification' });
        await expect(verification.getByText('Before screenshot', { exact: true })).toBeVisible();
        await expect(verification.getByText('After screenshot', { exact: true })).toBeVisible();
        const confirm = verification.getByRole('button', { name: 'Confirm fix', exact: true });
        if (isMobile) await confirm.tap(); else { await confirm.focus(); await confirm.press('Enter'); }
        await expect(verification).toContainText('Fix confirmed by');
        await page.goto(viewer + '&' + new URLSearchParams({ surface: designPage }));
        await page.getByRole('button', { name: 'Revoke pairing' }).click();
        await expect(page.getByRole('link', { name: 'Open paired live review' })).toHaveCount(0);
        expect((await page.request.get(openPath, { maxRedirects: 0 })).status()).toBe(404);
        expect((await page.request.get(designHref, { maxRedirects: 0 })).status()).toBe(404);
    } finally {
        await guestContext.close();
        await reviewerContext.close();
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
});
