import { createRequire } from 'node:module';
import { expect, test, type Locator, type Page } from '@playwright/test';
import sharp from 'sharp';
import { hydrated, setProjectAccess, signIn, uniqueEmail } from './support/app';

async function choose(page: Page, name: string, option: string) {
    await page.getByRole('combobox', { name, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
}

async function makeFileOnlyProject(page: Page) {
    await signIn(page, uniqueEmail('file-proof'));
    const mode = page.getByRole('radio', { name: 'Files only' });
    await hydrated(mode);
    await mode.click();
    await expect(page.getByRole('textbox', { name: 'Main site address' })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Brochure review');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.waitForURL(/\/projects\/[\w-]{21}\/files$/);
    return new URL(page.url()).pathname;
}

async function bitmap(name: string, background: string) {
    return { name, mimeType: 'image/png', buffer: await sharp({ create: { width: 320, height: 200, channels: 3, background } }).png().toBuffer() };
}

async function animation() {
    const frameSize = 320 * 200 * 3;
    const bytes = Buffer.concat([Buffer.alloc(frameSize, 60), Buffer.alloc(frameSize, 210)]);
    const buffer = await sharp(bytes, { raw: { width: 320, height: 400, pageHeight: 200, channels: 3 } })
        .gif({ delay: [250, 250], loop: 0 }).toBuffer();
    return { name: 'Cover-2.gif', mimeType: 'image/gif', buffer };
}

async function closeDialog(dialog: Locator) {
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();
}

test('file-only project reviews an image, preserves a thread permalink across revisions, and revokes guest access', async ({ page, browser, isMobile }) => {
    test.setTimeout(120_000);
    const files = await makeFileOnlyProject(page);
    const project = files.split('/')[3]!;
    const dialog = page.getByRole('dialog');
    await expect(page.getByRole('navigation', { name: 'Project' }).getByText('Page checks')).toHaveCount(0);
    await page.getByRole('button', { name: 'Upload file' }).click();
    await dialog.getByLabel('Choose file').setInputFiles(await bitmap('Cover.png', '#c0d1ef'));
    await dialog.getByRole('button', { name: 'Upload file' }).click();
    await expect(dialog.getByRole('link', { name: 'Version 1 · Cover.png' })).toBeVisible();
    const v1Path = await dialog.getByRole('link', { name: 'Version 1 · Cover.png' }).getAttribute('href');
    await closeDialog(dialog);
    await setProjectAccess(page, project, 'Anyone with the link');
    await page.goto(files);

    await page.getByRole('button', { name: 'New collection' }).click();
    await dialog.getByLabel('Collection name').fill('Launch files');
    await dialog.getByRole('button', { name: 'Create collection' }).click();
    await expect(page.getByRole('link', { name: 'Launch files' })).toBeVisible();
    await page.getByRole('button', { name: 'Manage Cover' }).click();
    await choose(page, 'Collection', 'Launch files');
    const saved = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes('/api/proofs/'));
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await closeDialog(dialog);
    await expect(page.getByRole('region', { name: 'Launch files', exact: true }).getByRole('link', { name: 'Cover', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Manage Cover' }).click();
    await dialog.getByRole('button', { name: 'Create review link' }).click();
    const share = await dialog.getByRole('textbox', { name: 'Review link', exact: true }).inputValue();
    expect(share).toContain('#share=');

    const guest = await browser.newContext({ viewport: isMobile ? { width: 390, height: 844 } : { width: 1200, height: 850 }, isMobile, hasTouch: isMobile });
    try {
        const review = await guest.newPage();
        await review.goto(share);
        await expect(review.getByRole('img', { name: 'File preview' })).toBeVisible();
        await expect(review).not.toHaveURL(/#share=/);
        await expect(review.getByRole('link', { name: 'Download original' })).toHaveCount(0);
        await choose(review, 'Review tool', 'Point pin');
        const work = review.getByRole('region', { name: 'File preview' });
        if (isMobile) {
            const surface = review.locator('[data-proof-surface="image"]');
            await surface.tap({ position: { x: 100, y: 70 } });
        } else {
            await work.focus();
            await work.press('ArrowRight');
            await work.press('Enter');
        }
        await expect(review.getByText('Using the selected location.')).toBeVisible();
        await review.getByLabel('Your name', { exact: true }).fill('Reviewer');
        await review.getByRole('textbox', { name: 'Add comment', exact: true }).fill('Check the title placement');
        await review.getByRole('button', { name: 'Add comment', exact: true }).click();
        await expect(review.getByRole('heading', { name: 'Thread #1' })).toBeVisible();
        const threadUrl = new URL(review.url());
        expect(threadUrl.searchParams.get('version')).not.toBeNull();
        expect(threadUrl.searchParams.get('thread')).toMatch(/^comment_/);
        await expect(review.getByRole('button', { name: 'Thread 1', exact: true })).toBeVisible();
        await review.getByRole('button', { name: 'Hide pins' }).click();
        await expect(review.getByRole('button', { name: 'Thread 1', exact: true })).toHaveCount(0);
        await expect(review.getByRole('heading', { name: 'Thread #1' })).toBeVisible();

        await dialog.getByLabel('New version file').setInputFiles(await animation());
        await dialog.getByRole('button', { name: 'Upload version' }).click();
        await expect(dialog.getByRole('link', { name: 'Version 2 · Cover-2.gif' })).toBeVisible();
        await review.goto(threadUrl.href);
        await expect(review.getByRole('combobox', { name: 'Version', exact: true })).toContainText('Version 1');
        await expect(review.getByRole('button', { name: 'Thread 1', exact: true })).toBeVisible();
        await choose(review, 'Compare with', 'Version 2');
        await choose(review, 'Comparison layout', 'Overlay');
        await expect(review.getByRole('slider', { name: 'Opacity' })).toBeVisible();
        await review.getByRole('button', { name: 'Open latest version' }).click();
        const animationCanvas = review.getByRole('img', { name: 'File preview' });
        const pixel = () => animationCanvas.evaluate(canvas => (canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data[0]);
        await expect.poll(pixel).toBe(60);
        await review.getByRole('button', { name: 'Next animation frame' }).click();
        await expect.poll(pixel).toBe(210);
        await dialog.getByRole('button', { name: 'Revoke', exact: true }).click();
        await expect(dialog.getByText('Revoked', { exact: true })).toBeVisible();
        await review.reload();
        await expect(review.getByRole('alert').filter({ hasText: 'This review link is unavailable.' })).toBeVisible();
        await closeDialog(dialog);
        await page.goto(v1Path!);
        await expect(page.getByRole('img', { name: 'File preview' })).toBeVisible();
    } finally {
        await guest.close();
    }
});

test('an admin can add the first site without changing the project’s Files link', async ({ page }) => {
    test.setTimeout(90_000);
    const files = await makeFileOnlyProject(page);
    const projectId = files.split('/')[3]!;
    const origin = 'http://localhost:9999';
    const siteReview = () => page.request.get(`/api/review/${projectId}`, { headers: { Origin: origin } });
    expect((await siteReview()).status()).toBe(403);
    await page.getByRole('link', { name: 'Add a site address' }).click();
    const address = page.getByRole('textbox', { name: 'Main site address' });
    await hydrated(address);
    await address.fill(origin);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    expect((await siteReview()).headers()['access-control-allow-origin']).toBe(origin);
    await expect(page.getByRole('navigation', { name: 'Project' }).getByRole('link', { name: 'Page checks' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Project' }).getByRole('link', { name: 'Files', exact: true })).toHaveAttribute('href', files);
    await address.fill('');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => address.evaluate(element => (element as HTMLInputElement).validity.valueMissing)).toBe(true);
    await page.reload();
    await expect(address).toHaveValue('localhost:9999');
});

/** A real text-layer PDF with deterministic geometry and independently orderable pages. */
function pdf(pages: string[]) {
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] >>`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    ];
    for (const [index, text] of pages.entries()) {
        const stream = `BT /F1 24 Tf 35 305 Td (${text}) Tj ET`;
        objects.push(
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 340 380] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
            `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
        );
    }
    let file = '%PDF-1.4\n';
    const offsets = objects.map((object, index) => {
        const start = Buffer.byteLength(file);
        file += `${index + 1} 0 obj\n${object}\nendobj\n`;
        return start;
    });
    const xref = Buffer.byteLength(file);
    file += `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) file += `${String(offset).padStart(10, '0')} 00000 n \n`;
    return Buffer.from(file + `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

test('PDF renderer paints real pages, searches text and pairs reordered pages', async ({ page }) => {
    test.setTimeout(90_000);
    const { version: pdfVersion } = createRequire(import.meta.url)('pdfjs-dist/package.json') as { version: string };
    const font = await page.request.get(`/proof-pdf/${pdfVersion}/standard_fonts/LiberationSans-Regular.ttf`);
    expect(font.ok()).toBe(true);
    expect(font.headers()['cache-control']).toContain('immutable');
    const projectId = 'pdf-fixture-123456789';
    const assetId = '00000000-0000-4000-8000-000000000001';
    const route = `/api/proofs/${projectId}/assets/${assetId}`;
    const versions = [
        { id: '10000000-0000-4000-8000-000000000001', pages: ['Price 45 EUR', 'Delivery in June'] },
        { id: '20000000-0000-4000-8000-000000000001', pages: ['Cover', 'Delivery in June', 'Price 49 EUR'] }
    ];
    const fixture = versions.map(({ id, pages }, index) => ({
        id, assetId, number: index + 1, status: 'published', filename: 'Pricing.pdf', contentType: 'application/pdf', size: pdf(pages).length,
        manifest: { format: 'pdf', surfaces: pages.map((_, page) => ({ id: `page-${page + 1}`, width: 340, height: 380 })) },
        artifacts: [{ id: 'pdf', contentType: 'application/pdf', size: pdf(pages).length, url: `${route}/versions/${id}/media/pdf` }]
    }));
    // Use fixture metadata here so this renderer regression runs even with PDF ingestion paused.
    await page.route(`**${route}**`, async request => {
        const url = new URL(request.request().url());
        const media = versions.find(version => url.pathname === `${route}/versions/${version.id}/media/pdf`);
        if (media) return request.fulfill({ contentType: 'application/pdf', body: pdf(media.pages) });
        if (url.pathname.endsWith('/threads')) return request.fulfill({ json: { threads: [], next: null, canComment: true, guest: false, statuses: [] } });
        if (url.pathname.endsWith('/verification')) return request.fulfill({ json: { threads: [], next: null, count: 0 } });
        if (url.pathname !== route) return request.fulfill({ status: 404 });
        const version = fixture.find(item => item.id === url.searchParams.get('version')) ?? fixture[1]!;
        return request.fulfill({ json: {
            asset: { id: assetId, name: 'Pricing guide', collectionId: null, position: 0, currentVersionId: fixture[1]!.id },
            versions: fixture, version, permissions: { view: true, comment: true, downloadOriginal: false, manage: false }
        } });
    });
    await page.goto(`/proof/${projectId}/${assetId}?version=${fixture[0]!.id}`);
    const primary = page.getByRole('region', { name: 'File preview' });
    await expect(primary.locator('.proof-pdf-text')).toContainText('Price 45 EUR', { timeout: 20_000 });
    expect(await primary.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
        const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        return pixels.some((channel, index) => index % 4 === 0 && channel < 100);
    })).toBe(true);
    await page.getByRole('searchbox', { name: 'Find in PDF' }).fill('Delivery');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('button', { name: 'Page 2 · Delivery in June' }).click();
    await expect(primary.locator('.proof-pdf-text')).toContainText('Delivery in June');
    await choose(page, 'Compare with', 'Version 2');
    const reference = page.getByRole('region', { name: 'Reference preview' });
    await expect(reference.locator('.proof-pdf-text')).toContainText('Delivery in June');
    await page.getByRole('button', { name: 'Previous page or frame' }).click();
    await expect(page.getByText('Choose the matching reference page.')).toBeVisible();
    await choose(page, 'Reference page or frame', 'Page 3');
    await page.getByText('PDF text changes', { exact: true }).click();
    await expect(page.locator('del')).toHaveText('45');
    await expect(page.locator('ins')).toHaveText('49');
});

test('a published PDF preserves an anchored copy replacement at its original page', async ({ page, isMobile }) => {
    test.setTimeout(120_000);
    await makeFileOnlyProject(page);
    await page.getByRole('button', { name: 'File formats', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: 'PDFs', exact: true }).click();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Upload file', exact: true }).click();
    await dialog.getByLabel('Choose file').setInputFiles({
        name: 'Menu.pdf', mimeType: 'application/pdf', buffer: pdf(['Cover', 'Dinner 45 EUR'])
    });
    await dialog.getByRole('button', { name: 'Upload file', exact: true }).click();
    const version = dialog.getByRole('link', { name: 'Version 1 · Menu.pdf', exact: true });
    await expect(version).toBeVisible({ timeout: 80_000 });
    await version.click();

    await page.getByRole('button', { name: 'Next page or frame', exact: true }).click();
    const surface = page.locator('[data-proof-surface]').first();
    const quote = surface.locator('.proof-pdf-text span').filter({ hasText: /\bDinner\b/ }).first();
    await expect(quote).toBeVisible();
    const pageId = await surface.getAttribute('data-proof-surface');
    await choose(page, 'Review tool', 'Quote text');
    if (isMobile) {
        await page.getByText('Choose PDF text', { exact: true }).tap();
        await page.getByRole('button', { name: /Dinner.*45 EUR/ }).tap();
    } else {
        await quote.evaluate(element => {
            const range = document.createRange();
            const first = element.firstChild!;
            const start = first.textContent!.indexOf('Dinner');
            range.setStart(first, start);
            range.setEnd(first, start + 'Dinner'.length);
            window.getSelection()?.removeAllRanges();
            window.getSelection()?.addRange(range);
            element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        });
    }
    await expect(page.getByText('Using the selected location.')).toBeVisible();
    const suggest = page.getByRole('button', { name: 'Suggest replacement', exact: true });
    if (isMobile) await suggest.tap();
    else { await suggest.focus(); await suggest.press('Enter'); }
    await expect(page.getByRole('textbox', { name: 'Suggested replacement' })).toBeFocused();
    await page.getByRole('textbox', { name: 'Suggested replacement' }).fill('Evening menu');
    const created = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/threads'));
    await page.getByRole('button', { name: 'Post suggestion', exact: true }).click();
    const response = await created;
    expect(response.ok()).toBe(true);
    const { thread } = await response.json() as { thread: { href: string; target: { suggestion: unknown }; location: { anchor: unknown } } };
    expect(thread.location.anchor).toMatchObject({ kind: 'text', surfaceId: pageId, quote: isMobile ? expect.stringMatching(/Dinner.*45 EUR/) : 'Dinner' });
    expect(thread.target.suggestion).toEqual({ replacement: 'Evening menu' });
    await page.goto(thread.href);
    await expect(page.locator('[data-proof-surface]').first()).toHaveAttribute('data-proof-surface', pageId!);
    await expect(page.locator('[data-proof-quote]').first()).toContainText('Dinner');
    await expect(page.getByText('Suggested replacement', { exact: true })).toBeVisible();
    await expect(page.getByRole('definition').filter({ hasText: 'Evening menu' })).toBeVisible();
});
