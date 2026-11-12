import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { publishToolbar } from '../scripts/toolbar-assets.mjs';

test('the bootstrap stays small and pins the exact integrity-checked review script', async () => {
    const loader = await readFile(new URL('../../../packages/toolbar/dist/index.js', import.meta.url));
    const review = await readFile(new URL('../../../packages/toolbar/dist/review.js', import.meta.url));
    expect(loader.length).toBeLessThan(7_500);
    expect(gzipSync(loader).length).toBeLessThan(3_100);
    expect(loader.toString()).toContain(`/toolbar/${createHash('sha256').update(review).digest('hex')}.js`);
    expect(loader.toString()).toContain(`sha384-${createHash('sha384').update(review).digest('base64')}`);
});

test('the accessibility audit (axe-core) is its own pinned, integrity-checked asset, never in the loader or the review script', async ({ request }) => {
    const loader = (await readFile(new URL('../../../packages/toolbar/dist/index.js', import.meta.url))).toString();
    const review = (await readFile(new URL('../../../packages/toolbar/dist/review.js', import.meta.url))).toString();
    const audit = await readFile(new URL('../../../packages/toolbar/dist/audit.js', import.meta.url));
    const path = `/toolbar/${createHash('sha256').update(audit).digest('hex')}.js`;
    expect(review).toContain(path);
    expect(review).toContain(`sha384-${createHash('sha384').update(audit).digest('base64')}`);
    // axe-core's licence notice marks its code: only the audit asset has it
    expect(audit.toString()).toContain('Deque Systems');
    for (const script of [loader, review]) expect(script).not.toContain('Deque Systems');
    const served = await request.get(path);
    expect(served.status()).toBe(200);
    expect(served.headers()['access-control-allow-origin']).toBe('*');
    expect(served.headers()['cache-control']).toContain('immutable');
    expect(Buffer.compare(await served.body(), audit)).toBe(0);
});

test('each language but English is its own pinned, integrity-checked asset, never in the review script or the audit', async ({ request }) => {
    const dist = new URL('../../../packages/toolbar/dist/', import.meta.url);
    const review = (await readFile(new URL('review.js', dist))).toString();
    const audit = (await readFile(new URL('audit.js', dist))).toString();
    // English is part of the review script; the toolbar's and the checks' strings of the others are in their asset
    expect(review).toContain('Your choice stays in this browser.');
    const samples = { de: ['Ihre Auswahl bleibt in diesem Browser.', 'Keine Bilder auf dieser Seite.'], fr: ['Votre choix reste dans ce navigateur.', 'Aucune image sur cette page.'],
        es: ['se queda en este navegador.'], it: ['La tua scelta resta in questo browser.'], hr: ['ostaje u ovom pregledniku.'] };
    for (const [language, strings] of Object.entries(samples)) {
        const asset = await readFile(new URL(`language-${language}.js`, dist));
        const path = `/toolbar/${createHash('sha256').update(asset).digest('hex')}.js`;
        expect(review).toContain(`"${language}":{"path":"${path}","integrity":"sha384-${createHash('sha384').update(asset).digest('base64')}"}`);
        for (const text of strings) {
            expect(asset.toString(), language).toContain(text);
            for (const script of [review, audit]) expect(script, language).not.toContain(text);
        }
        const served = await request.get(path);
        expect(served.status()).toBe(200);
        expect(served.headers()['access-control-allow-origin']).toBe('*');
        expect(Buffer.compare(await served.body(), asset)).toBe(0);
    }
});

test('pins survive a clean deployment, hashes are verified, and only expired pins are pruned', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'uier-pins-'));
    const source = join(directory, 'source.js');
    const review = join(directory, 'review.js');
    const first = join(directory, 'first');
    const second = join(directory, 'second');
    const firstReview = `/*${'x'.repeat(760_000)}*/`;
    let corrupt = false;
    const server = createServer(async (request, response) => {
        try {
            const path = request.url!;
            response.end(corrupt && path.endsWith('.js') ? 'tampered' : await readFile(join(first, path)));
        } catch { response.writeHead(404).end(); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const retainFrom = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
        await writeFile(source, 'console.log("first");');
        await writeFile(review, firstReview);
        const reviewPath = `/toolbar/${createHash('sha256').update(await readFile(review)).digest('hex')}.js`;
        const a = await publishToolbar(source, first, { now: new Date('2026-01-01'), dependencies: [review] });
        await writeFile(source, 'console.log("second");');
        await writeFile(review, 'console.log("second review");');
        const b = await publishToolbar(source, second, { retainFrom, now: new Date('2026-01-02'), dependencies: [review] });
        expect(a.path).not.toBe(b.path);
        expect(await readFile(join(second, a.path), 'utf8')).toBe('console.log("first");');
        expect(await readFile(join(second, b.path), 'utf8')).toBe('console.log("second");');
        expect(await readFile(join(second, 'toolbar.js'), 'utf8')).toBe('console.log("second");');
        expect(await readFile(join(second, reviewPath), 'utf8')).toBe(firstReview);
        corrupt = true;
        await expect(publishToolbar(source, second, { retainFrom, now: new Date('2026-01-03') })).rejects.toThrow('hash mismatch');
        corrupt = false;
        // A failed production archive request is not silently treated as an empty archive.
        const failure = createServer((_request, response) => response.writeHead(503).end());
        await new Promise<void>(resolve => failure.listen(0, '127.0.0.1', resolve));
        try {
            await expect(publishToolbar(source, second, { retainFrom: `http://127.0.0.1:${(failure.address() as AddressInfo).port}` }))
                .rejects.toThrow('503');
        } finally { await new Promise<void>(resolve => failure.close(() => resolve())); }
        await publishToolbar(source, second, { now: new Date('2027-01-03') });
        await expect(readFile(join(second, a.path))).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(readFile(join(second, reviewPath))).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await readFile(join(second, b.path), 'utf8')).toBe('console.log("second");');
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
        await rm(directory, { recursive: true, force: true });
    }
});

test('new and retained toolbar bundles share the same bounded size limit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'uier-pin-limits-'));
    const source = join(directory, 'source.js');
    const review = join(directory, 'review.js');
    const output = join(directory, 'public');
    const oversized = Buffer.alloc(1_500_001, 'x');
    const id = createHash('sha256').update(oversized).digest('hex');
    const server = createServer((request, response) => {
        response.end(request.url === '/toolbar/manifest.json'
            ? JSON.stringify({ version: 1, bundles: { [id]: '2026-01-01T00:00:00.000Z' } })
            : oversized);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        await writeFile(source, 'console.log("loader");');
        await writeFile(review, oversized.subarray(0, 1_500_000));
        await publishToolbar(source, output, { dependencies: [review] });
        await writeFile(review, oversized);
        await expect(publishToolbar(source, output, { dependencies: [review] })).rejects.toThrow('Toolbar bundle exceeds its size limit');
        await writeFile(source, oversized);
        await expect(publishToolbar(source, output)).rejects.toThrow('Toolbar bundle exceeds its size limit');
        await writeFile(source, 'console.log("loader");');
        const retainFrom = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        await expect(publishToolbar(source, output, { retainFrom, now: new Date('2026-01-02') }))
            .rejects.toThrow('Toolbar archive exceeds its size limit');
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
        await rm(directory, { recursive: true, force: true });
    }
});
