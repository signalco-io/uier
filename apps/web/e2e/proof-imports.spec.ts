import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { proofApiPath } from '../src/lib/proofs/model';
import { hydrated, setProjectAccess, signIn, uniqueEmail } from './support/app';

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

test('directory upload runs its local JavaScript in the isolated prototype viewer', async ({ page }) => {
    test.skip(!process.env.NEXT_PUBLIC_UIER_PROOF_HTML_ORIGIN, 'Run with the separate prototype origin configured.');
    test.setTimeout(120_000);
    await project(page);
    await enable(page, 'HTML prototypes');
    const directory = await mkdtemp(join(tmpdir(), 'proof-menu-'));
    try {
        await writeFile(join(directory, 'index.html'), '<!doctype html><h1>Prototype menu</h1><button id="toggle">Open menu</button><p id="menu" hidden>Our recipes</p><script src="app.js"></script>');
        await writeFile(join(directory, 'app.js'), "document.querySelector('#toggle').onclick = () => document.querySelector('#menu').hidden = false;");
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
