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
    expect(loader.length).toBeLessThan(12_000);
    expect(gzipSync(loader).length).toBeLessThan(5_000);
    expect(loader.toString()).toContain(`/toolbar/${createHash('sha256').update(review).digest('hex')}.js`);
    expect(loader.toString()).toContain(`sha384-${createHash('sha384').update(review).digest('base64')}`);
});

test('pins survive a clean deployment, hashes are verified, and only expired pins are pruned', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'uier-pins-'));
    const source = join(directory, 'source.js');
    const review = join(directory, 'review.js');
    const first = join(directory, 'first');
    const second = join(directory, 'second');
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
        await writeFile(review, 'console.log("first review");');
        const reviewPath = `/toolbar/${createHash('sha256').update(await readFile(review)).digest('hex')}.js`;
        const a = await publishToolbar(source, first, { now: new Date('2026-01-01'), dependencies: [review] });
        await writeFile(source, 'console.log("second");');
        await writeFile(review, 'console.log("second review");');
        const b = await publishToolbar(source, second, { retainFrom, now: new Date('2026-01-02'), dependencies: [review] });
        expect(a.path).not.toBe(b.path);
        expect(await readFile(join(second, a.path), 'utf8')).toBe('console.log("first");');
        expect(await readFile(join(second, b.path), 'utf8')).toBe('console.log("second");');
        expect(await readFile(join(second, 'toolbar.js'), 'utf8')).toBe('console.log("second");');
        expect(await readFile(join(second, reviewPath), 'utf8')).toBe('console.log("first review");');
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
