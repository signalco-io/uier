import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { proofApiPath, proofViewerPath, type ProofVersion } from '../src/lib/proofs/model';
import type { ProofThread } from '../src/lib/proofs/threadModel';
import { enableProjectVerification, hydrated, setProjectAccess, signIn, uniqueEmail } from './support/app';

async function project(page: Page) {
    await signIn(page, uniqueEmail('proof-import'));
    await page.goto('/app/projects/new');
    const files = page.getByRole('radio', { name: 'Files only' });
    await hydrated(files);
    await files.click();
    await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Source import proof');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.waitForURL(/\/projects\/[\w-]{21}\/files$/);
    return new URL(page.url()).pathname;
}

async function enable(page: Page, format: string) {
    await page.getByRole('button', { name: 'File formats' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: format, exact: true }).check();
    const reply = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith('/settings'));
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await reply).status()).toBe(200);
    await expect(dialog).toBeHidden();
}

test('restricted reviewer opens and searches the display PDF in the proof viewer', async ({ page, browser }) => {
    test.setTimeout(120_000);
    const files = await project(page);
    const projectId = files.split('/')[3]!;
    await enable(page, 'PDFs');
    const pdf = await PDFDocument.create();
    pdf.setTitle('AGENT-PRIVATE-DRAFT-TITLE');
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([400, 500]).drawText('Menu introduction', { x: 40, y: 400, size: 32, font });
    pdf.addPage([400, 500]).drawText('Rosemary focaccia', { x: 40, y: 400, size: 32, font });
    const buffer = Buffer.from(await pdf.save());
    await page.getByRole('button', { name: 'Upload file', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Choose file').setInputFiles({ name: 'Menu.pdf', mimeType: 'application/pdf', buffer });
    await dialog.getByRole('button', { name: 'Upload file', exact: true }).click();
    await expect(dialog.getByRole('link', { name: 'Version 1 · Menu.pdf' })).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await setProjectAccess(page, projectId, 'Anyone with the link');
    await page.goto(files);
    const api = proofApiPath(projectId);
    const asset = (await (await page.request.get(api)).json()).assets[0];
    const share = await page.request.post(api + '/shares', { headers: { Origin: new URL(page.url()).origin },
        data: { scope: { kind: 'asset', id: asset.id }, permission: 'view', downloadOriginal: false } });
    expect(share.status()).toBe(201);
    const guest = await browser.newContext();
    try {
        const review = await guest.newPage();
        await review.goto((await share.json()).url);
        const search = review.getByRole('searchbox', { name: 'Find in PDF' });
        await expect(search).toBeVisible({ timeout: 30_000 });
        await search.fill('Rosemary');
        await review.getByRole('button', { name: 'Search', exact: true }).click();
        await review.getByRole('button', { name: /Page 2.*Rosemary/ }).click();
        await expect(review.locator('canvas[aria-label="Page 2"]')).toBeVisible();
        await expect(review.getByRole('link', { name: 'Download original' })).toHaveCount(0);
    } finally { await guest.close(); }
});

test('an isolated prototype reopens captured and restorable menu states after an agent publishes a revision', async ({ page, browser, isMobile }) => {
    test.skip(!process.env.NEXT_PUBLIC_UIER_PROOF_HTML_ORIGIN, 'Run with the separate prototype origin configured.');
    test.setTimeout(120_000);
    const files = await project(page);
    const projectId = files.split('/')[3]!;
    await enable(page, 'HTML prototypes');
    const directory = await mkdtemp(join(tmpdir(), 'proof-menu-'));
    try {
        await writeFile(join(directory, 'index.html'), `<!doctype html><h1>Prototype menu</h1>
            <button id="toggle" aria-expanded="false">Open menu</button>
            <div role="menu" id="menu" hidden><button role="menuitem">Our recipes</button><button role="menuitem">Saved recipes</button></div>
            <details><summary>Open native menu</summary><p>Native menu copy</p></details>
            <input type="password" value="test-secret-form-value"><script src="app.js"></script>`);
        await writeFile(join(directory, 'app.js'), `document.querySelector('#toggle').onclick = (event) => {
            document.querySelector('#menu').hidden = false;
            event.target.setAttribute('aria-expanded', 'true');
        };`);
        await page.getByRole('button', { name: 'Upload file', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Choose prototype directory').setInputFiles(directory);
        await dialog.getByRole('textbox', { name: 'File name' }).fill('Prototype directory');
        await dialog.getByRole('button', { name: 'Upload file', exact: true }).click();
        await dialog.getByRole('link', { name: /Version 1 · .*\.zip/ }).click();
        const iframe = page.locator('iframe[title="Interactive prototype"]');
        await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
        expect(new URL((await iframe.getAttribute('src'))!).origin).not.toBe(new URL(page.url()).origin);
        const prototype = page.frameLocator('iframe[title="Interactive prototype"]');
        await prototype.getByRole('button', { name: 'Open menu' }).click();
        await expect(prototype.getByText('Our recipes')).toBeVisible();
        await expect(prototype.locator('html')).toHaveCount(1);
        const canAccess = await prototype.locator('body').evaluate(() => {
            try { return Boolean(window.parent.document); } catch { return false; }
        });
        expect(canAccess).toBe(false);
        const item = prototype.getByRole('menuitem', { name: 'Our recipes' });
        if (isMobile) {
            await page.getByRole('button', { name: 'Pick a prototype element' }).tap();
            await item.tap();
        } else {
            await item.focus();
            await item.press('Alt+Shift+A');
            await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
            await item.press('Enter');
        }
        const thread = await addThread(page, 'Rename this menu item');
        expect(thread.target.source.anchor).toMatchObject({ kind: 'prototype', surfaceId: 'prototype',
            capture: { nodes: expect.arrayContaining([expect.objectContaining({ label: 'Our recipes' }), expect.objectContaining({ label: 'Saved recipes' })]) } });
        expect(JSON.stringify(thread.target.source)).not.toContain('test-secret-form-value');
        const assetId = thread.target.assetId;
        const initialVersion = thread.target.source.versionId;

        await page.goto(proofViewerPath(projectId, assetId, initialVersion));
        await prototype.getByText('Open native menu', { exact: true }).click();
        await page.getByRole('button', { name: 'Pick a prototype element' }).click();
        await prototype.getByText('Native menu copy', { exact: true }).evaluate(element => {
            const range = document.createRange();
            range.selectNodeContents(element);
            window.getSelection()?.removeAllRanges();
            window.getSelection()?.addRange(range);
        });
        await page.getByRole('button', { name: 'Use selected text', exact: true }).click();
        const native = await addThread(page, 'Keep the native menu copy');
        expect(native.location.anchor).toMatchObject({ kind: 'prototype', selection: { quote: 'Native menu copy' },
            capture: { native: [expect.objectContaining({ control: 'details' })] } });
        await page.goto(native.href);
        await expect(prototype.locator('details')).toHaveAttribute('open', '');
        await expect(prototype.getByText('Native menu copy')).toBeVisible();
        await expect(page.getByRole('figure', { name: 'Captured prototype evidence' })).toHaveCount(0);

        await setProjectAccess(page, projectId, 'Anyone with the link');
        const origin = new URL(page.url()).origin;
        const shareResponse = await page.request.post(proofApiPath(projectId) + '/shares', { headers: { Origin: origin },
            data: { scope: { kind: 'asset', id: assetId }, permission: 'view', downloadOriginal: false } });
        expect(shareResponse.status(), await shareResponse.text()).toBe(201);
        const { url: shareUrl, share } = await shareResponse.json();

        await page.goto('/app/account/coding-agents');
        await page.getByRole('button', { name: 'Show access tokens' }).click();
        await page.getByLabel('Token label').fill('Proof uploader');
        await page.getByRole('checkbox', { name: 'Source import proof', exact: true }).check();
        await page.getByRole('checkbox', { name: 'Upload proof versions', exact: true }).check();
        await page.getByRole('button', { name: 'Create token', exact: true }).click();
        const secret = page.locator('code').filter({ hasText: /^uier_mcp\./ });
        await expect(secret).toBeVisible();
        const client = new Client({ name: 'Prototype uploader', version: '1.0.0' });
        await client.connect(new StreamableHTTPClientTransport(new URL('/api/mcp', origin), {
            requestInit: { headers: { Authorization: 'Bearer ' + await secret.textContent() } }
        }));
        try {
            const projects = (await client.callTool({ name: 'list_projects', arguments: {} })).structuredContent as { items: { id: string; name: string }[] };
            const target = projects.items.find(item => item.name === 'Source import proof')!;
            const revision = Buffer.from('<!doctype html><h1>Prototype version two</h1><button>Explore recipes</button>');
            const opened = await client.callTool({ name: 'begin_proof_upload', arguments: { projectId: target.id, assetId,
                requestId: crypto.randomUUID(), expectedVersionId: initialVersion, filename: 'prototype-v2.html', contentType: 'text/html', size: revision.length } });
            expect(opened.isError, JSON.stringify(opened.structuredContent)).not.toBe(true);
            const grant = opened.structuredContent as { versionId: string; uploadUrl: string; headers: Record<string, string> };
            const uploader = await browser.newContext();
            try {
                expect((await uploader.request.put(grant.uploadUrl, { headers: { ...grant.headers, Origin: origin }, data: revision })).status()).toBe(204);
            } finally { await uploader.close(); }
            const published = await client.callTool({ name: 'finalize_proof_upload', arguments: { projectId: target.id, assetId, versionId: grant.versionId } });
            expect(published.isError, JSON.stringify(published.structuredContent)).not.toBe(true);
            expect(published.structuredContent).toMatchObject({ number: 2, format: 'html' });
        } finally { await client.close(); }

        const guest = await browser.newContext({ baseURL: origin });
        try {
            const review = await guest.newPage();
            const frame = review.frameLocator('iframe[title="Interactive prototype"]');
            await review.goto(shareUrl);
            await expect(frame.getByRole('heading', { name: 'Prototype version two' })).toBeVisible();
            await review.goto(thread.href);
            await expect(review.getByRole('status').filter({ hasText: 'The live state could not be restored.' })).toBeVisible();
            const capture = review.getByRole('figure', { name: 'Captured prototype evidence', exact: true });
            await expect(capture.getByText('Saved recipes', { exact: true })).toBeVisible();
            await expect(review.getByRole('combobox', { name: 'Version' })).toContainText('Version 1');
            await review.getByRole('button', { name: 'Interactive prototype', exact: true }).click();
            await expect(frame.getByRole('button', { name: 'Open menu', exact: true })).toBeVisible();
            const isolated = await review.locator('iframe[title="Interactive prototype"]').getAttribute('src');
            const revoked = await page.request.delete(proofApiPath(projectId) + '/shares/' + share.id, { headers: { Origin: origin } });
            expect(revoked.status()).toBe(204);
            expect((await guest.request.get(isolated!)).status()).toBe(404);
            expect((await guest.request.get(proofApiPath(projectId) + '/assets/' + assetId + '/threads/' + thread.id + '?version=' + initialVersion)).status()).toBe(404);
            await page.goto(thread.href);
            await expect(page.getByRole('figure', { name: 'Captured prototype evidence' })).toBeVisible();
        } finally { await guest.close(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Files creates and rotates a test email address', async ({ page }) => {
    test.skip(!process.env.UIER_PROOF_EMAIL_ALIAS, 'Run with the local mail ingress fixture configured.');
    test.setTimeout(120_000);
    await project(page);
    await enable(page, 'Emails');
    await page.getByRole('button', { name: 'Upload file', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'File name' }).fill('Test campaign');
    await dialog.getByRole('button', { name: 'Create file for test email' }).click();
    await dialog.getByRole('button', { name: 'Create test address' }).click();
    const address = dialog.getByRole('textbox', { name: 'Send a test email to' });
    await expect(address).toHaveValue(/^proofs\+[a-f0-9]{40}@review\.uier\.io$/);
    const original = await address.inputValue();
    await dialog.getByRole('button', { name: 'Rotate test address' }).click();
    await expect(address).not.toHaveValue(original);
    await dialog.getByRole('button', { name: 'Disable test address' }).click();
    await expect(address).toHaveCount(0);
});

async function pickOption(page: Page, label: string, option: string) {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
}

async function publish(page: Page, projectId: string, source: { name: string; type: string; data: Buffer }, previous?: { assetId: string; id: string }) {
    const root = proofApiPath(projectId);
    const headers = { Origin: new URL(page.url()).origin };
    const assetId = previous?.assetId ?? (await (await page.request.post(root + '/assets', { headers, data: { name: source.name } })).json()).asset.id;
    const uploads = root + '/assets/' + assetId + '/uploads';
    const opened = await page.request.post(uploads, { headers, data: { filename: source.name, contentType: source.type,
        size: source.data.length, requestId: crypto.randomUUID(), expectedVersionId: previous?.id ?? null } });
    expect(opened.ok(), await opened.text()).toBe(true);
    const grant = await opened.json();
    const stored = await page.request.put(grant.uploadUrl, { headers: { ...headers, ...grant.headers }, data: source.data });
    expect(stored.status(), await stored.text()).toBe(204);
    const finalized = await page.request.post(uploads + '/' + grant.version.id + '/finalize', { headers });
    expect(finalized.ok(), await finalized.text()).toBe(true);
    const { version } = await finalized.json() as { version: ProofVersion };
    return { ...version, href: proofViewerPath(projectId, assetId, version.id) };
}

async function addThread(page: Page, message: string) {
    await page.getByRole('textbox', { name: 'Add comment', exact: true }).fill(message);
    const added = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/threads'));
    await page.getByRole('button', { name: 'Add comment', exact: true }).click();
    const response = await added;
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json() as { thread: ProofThread }).thread;
}

async function seekVideo(page: Page, ms: number) {
    const video = page.getByRole('region', { name: 'File preview', exact: true });
    const slider = video.getByRole('slider', { name: 'Video position' });
    await slider.focus();
    await slider.press('Home');
    const display = video.locator('video');
    // Dispatch the slider's native input event for a deterministic millisecond seek.
    await slider.evaluate((input, value) => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        set.call(input, String(value));
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }, ms);
    await expect.poll(() => display.evaluate(player => Math.round((player as HTMLVideoElement).currentTime * 1000))).toBe(ms);
}

test('a timed video pin survives resize and needs explicit correspondence on a trimmed clip', async ({ page, isMobile }) => {
    test.setTimeout(90_000);
    const files = await project(page);
    const projectId = files.split('/')[3]!;
    await enable(page, 'Videos');
    const clip = (name: string) => readFile(new URL('./fixtures/' + name, import.meta.url));
    // The second clip starts one second into the first and keeps the following frames.
    const first = await publish(page, projectId, { name: 'proof-clip.mp4', type: 'video/mp4', data: await clip('proof-clip.mp4') });
    const second = await publish(page, projectId, { name: 'proof-clip-trimmed.mp4', type: 'video/mp4', data: await clip('proof-clip-trimmed.mp4') }, first);
    expect(first.manifest?.durationMs! - second.manifest?.durationMs!).toBe(1000);
    await page.goto(first.href);
    const main = page.getByRole('region', { name: 'File preview', exact: true });
    const video = main.locator('video');
    await video.scrollIntoViewIfNeeded();
    await expect(main.getByRole('slider', { name: 'Video position' })).toBeEnabled({ timeout: 15_000 });
    await seekVideo(page, 1450);
    await main.getByRole('button', { name: 'Step forward', exact: true }).click();
    await expect.poll(() => video.evaluate(player => Math.round((player as HTMLVideoElement).currentTime * 1000))).toBe(1500);
    await main.getByRole('button', { name: 'Step backward', exact: true }).click();
    await expect.poll(() => video.evaluate(player => Math.round((player as HTMLVideoElement).currentTime * 1000))).toBe(1450);
    await pickOption(page, 'Review tool', 'Point pin');
    if (isMobile) await page.locator('[data-proof-surface="video"]').tap({ position: { x: 78, y: 30 } });
    else {
        await main.focus();
        await main.press('ArrowRight');
        await main.press('Enter');
    }
    const thread = await addThread(page, 'Check the moving marker');
    expect(thread.location.anchor).toMatchObject({ kind: 'time', surfaceId: 'video', startMs: 1450,
        geometry: { x: expect.any(Number), y: expect.any(Number) } });

    await page.goto(thread.href);
    await expect.poll(() => video.evaluate(player => Math.round((player as HTMLVideoElement).currentTime * 1000))).toBe(1450);
    const pin = main.getByRole('button', { name: /Thread .* at 0:01\.450/ });
    await expect(pin).toBeVisible();
    const position = await pin.getAttribute('style');
    await page.setViewportSize(isMobile ? { width: 780, height: 420 } : { width: 950, height: 840 });
    await expect(pin).toHaveAttribute('style', position!);

    const newest = new URL(second.href, page.url());
    newest.searchParams.set('thread', thread.id);
    await page.goto(newest.href);
    await expect(page.getByRole('button', { name: 'Reconfirm video location' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save revised location' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Reconfirm video location' }).click();
    await expect(page.getByText(/The clip may have been trimmed/)).toContainText('0:01.450');
    await expect.poll(() => page.getByRole('region', { name: 'Reference preview' }).locator('video').evaluate(player => Math.round((player as HTMLVideoElement).currentTime * 1000))).toBe(1450);
    await seekVideo(page, 450);
    await main.getByRole('button', { name: 'Keep position at this time' }).click();
    const saved = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes('/threads/' + thread.id));
    await page.getByRole('button', { name: 'Save revised location' }).click();
    const response = await saved;
    expect(response.ok(), await response.text()).toBe(true);
    const result = (await response.json() as { thread: ProofThread }).thread;
    expect(result.target.source).toEqual(thread.target.source);
    expect(result.location).toEqual({ versionId: second.id, anchor: { ...thread.location.anchor, startMs: 450 } });
    await page.reload();
    await expect.poll(() => video.evaluate(player => Math.round((player as HTMLVideoElement).currentTime * 1000))).toBe(450);
    await expect(main.getByRole('button', { name: /Thread .* at 0:00\.450/ })).toBeVisible();
});

test('email subject, CTA and body copy suggestions stay anchored through before and after', async ({ page, browser, isMobile }) => {
    test.setTimeout(90_000);
    const files = await project(page);
    const projectId = files.split('/')[3]!;
    await enable(page, 'Emails');
    await enableProjectVerification(page, projectId);
    await setProjectAccess(page, projectId, 'Anyone with the link');
    const email = (subject: string, cta: string, copy: string) => Buffer.from([
        'From: Team <team@example.test>', 'To: proof@example.test', 'Subject: ' + subject, 'MIME-Version: 1.0',
        'Content-Type: text/html; charset=utf-8', '',
        '<p>' + copy + '</p><p><a href="https://example.test/sale">' + cta + '</a></p>',
        '<img src="https://example.test/pixel" alt=""><script>window.emailScript = true</script>'
    ].join('\r\n'));
    const first = await publish(page, projectId, { name: 'campaign.eml', type: 'message/rfc822', data: email('Winter sale', 'See more', 'Sale starts tomorrow') });
    const second = await publish(page, projectId, { name: 'campaign-2.eml', type: 'message/rfc822', data: email('Winter offers', 'Shop winter offers', 'Save on winter essentials') }, first);
    const origin = new URL(page.url()).origin;
    const shared = await page.request.post(proofApiPath(projectId) + '/shares', { headers: { Origin: origin },
        data: { scope: { kind: 'asset', id: first.assetId }, permission: 'comment', downloadOriginal: false } });
    expect(shared.status(), await shared.text()).toBe(201);
    const guest = await browser.newContext({ baseURL: origin,
        viewport: isMobile ? { width: 390, height: 844 } : { width: 1200, height: 850 }, isMobile, hasTouch: isMobile });
    try {
        const review = await guest.newPage();
        await review.goto((await shared.json()).url);
        await expect(review.getByRole('textbox', { name: 'Your name', exact: true })).toBeVisible();
        await review.goto(first.href);
        const guestPreview = review.getByRole('region', { name: 'File preview', exact: true });
        const click = async (locator: Locator) => {
            if (isMobile) await locator.tap();
            else { await locator.focus(); await locator.press('Enter'); }
        };
        const suggest = async (replacement: string) => {
            await review.getByRole('textbox', { name: 'Your name', exact: true }).fill('Campaign reviewer');
            await click(review.getByRole('button', { name: 'Suggest replacement', exact: true }));
            await expect(review.getByRole('textbox', { name: 'Suggested replacement', exact: true })).toBeFocused();
            await review.getByRole('textbox', { name: 'Suggested replacement', exact: true }).fill(replacement);
            const saved = review.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/threads'));
            await click(review.getByRole('button', { name: 'Post suggestion', exact: true }));
            const response = await saved;
            expect(response.ok(), await response.text()).toBe(true);
            return (await response.json() as { thread: ProofThread }).thread;
        };

        await click(guestPreview.getByRole('button', { name: 'Annotate Subject', exact: true }));
        const subject = await suggest('Winter offers');
        expect(subject.target).toMatchObject({ source: { anchor: { kind: 'text', field: 'subject', quote: 'Winter sale' } },
            suggestion: { replacement: 'Winter offers' } });

        const iframe = guestPreview.locator('iframe');
        await expect(iframe).toHaveAttribute('sandbox', '');
        const emailBody = guestPreview.frameLocator('iframe');
        await expect(emailBody.getByText('See more')).not.toHaveAttribute('href');
        await expect(emailBody.locator('img[src]')).toHaveCount(0);
        await click(guestPreview.getByText('Email calls to action', { exact: true }));
        await click(guestPreview.getByRole('button', { name: 'Annotate See more', exact: true }));
        const cta = await suggest('Shop winter offers');
        expect(cta.target).toMatchObject({ source: { anchor: { kind: 'text', field: 'cta', quote: 'See more', occurrence: 0 } },
            suggestion: { replacement: 'Shop winter offers' } });

        await click(guestPreview.getByRole('button', { name: 'Plain text', exact: true }));
        await click(guestPreview.getByText('Choose body text', { exact: true }));
        await click(guestPreview.getByRole('button', { name: 'Sale starts tomorrow', exact: true }));
        const body = await suggest('Save on winter essentials');
        expect(body.target).toMatchObject({ source: { anchor: { kind: 'text', field: 'body', quote: 'Sale starts tomorrow' } },
            suggestion: { replacement: 'Save on winter essentials' } });
        await review.goto(body.href);
        await expect(guestPreview.locator('mark')).toHaveText('Sale starts tomorrow');

        await page.goto(cta.href);
        const main = page.getByRole('region', { name: 'File preview', exact: true });
        await expect(main.frameLocator('iframe').locator('[data-proof-cta="0"]')).toHaveText('See more');
        await page.getByRole('button', { name: 'Request verification', exact: true }).click();
        const request = page.getByRole('form', { name: 'Request verification', exact: true });
        await request.getByRole('button', { name: 'Choose location', exact: true }).click();
        await expect(page.getByRole('combobox', { name: 'Version', exact: true })).toContainText('Version 2');
        await click(main.getByText('Email calls to action', { exact: true }));
        await click(main.getByRole('button', { name: 'Annotate Shop winter offers', exact: true }));
        const checked = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/verification'));
        await request.getByRole('button', { name: 'Request verification', exact: true }).click();
        const check = await checked;
        expect(check.ok(), await check.text()).toBe(true);
        const record = (await check.json() as { thread: ProofThread }).thread;
        expect(record.verification?.evidence).toMatchObject({ before: cta.target.source,
            after: { versionId: second.id, anchor: { kind: 'text', field: 'cta', quote: 'Shop winter offers' } } });

        await review.goto(proofViewerPath(projectId, second.assetId, second.id) + '&thread=' + cta.id);
        await review.getByRole('button', { name: 'Before', exact: true }).click();
        await expect(guestPreview.frameLocator('iframe').locator('[data-proof-cta="0"]')).toHaveText('See more');
        await expect(review.getByRole('region', { name: 'Reference preview' }).frameLocator('iframe').locator('[data-proof-cta="0"]')).toHaveText('Shop winter offers');
        await review.getByRole('button', { name: 'After', exact: true }).click();
        await expect(guestPreview.frameLocator('iframe').locator('[data-proof-cta="0"]')).toHaveText('Shop winter offers');
        await expect(review.getByText('Revised copy', { exact: true })).toBeVisible();
    } finally { await guest.close(); }
});
