import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const year = 365 * 24 * 60 * 60 * 1000;
const hashPattern = /^[a-f0-9]{64}$/;

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

async function download(url, limit) {
    const response = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (response.status === 404 && url.pathname.endsWith('/manifest.json')) return null; // First release only.
    if (!response.ok) throw new Error(`Toolbar archive returned ${response.status}: ${url.pathname}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
        size += chunk.length;
        if (size > limit) throw new Error('Toolbar archive exceeds its size limit');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

/**
 * Carry forward verified, supported pins before publishing the current build. No API credentials.
 * @param {string} source
 * @param {string} publicDir
 * @param {{ retainFrom?: string, now?: Date }} [options]
 */
export async function publishToolbar(source, publicDir, { retainFrom, now = new Date() } = {}) {
    const bytes = await readFile(source);
    const currentHash = hash(bytes);
    const directory = join(publicDir, 'toolbar');
    let previous;
    if (retainFrom) {
        const data = await download(new URL('/toolbar/manifest.json', retainFrom), 1024 * 1024);
        previous = data ? JSON.parse(data.toString()) : undefined;
    } else {
        try { previous = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (previous && (previous.version !== 1 || !previous.bundles || typeof previous.bundles !== 'object' || Array.isArray(previous.bundles))) {
        throw new Error('Invalid toolbar archive manifest');
    }
    const bundles = { [currentHash]: now.toISOString() };
    await mkdir(directory, { recursive: true });
    const entries = Object.entries(previous?.bundles ?? {});
    // Bounded concurrency keeps a year of assets from making the deployment serial or unbounded.
    for (let offset = 0; offset < entries.length; offset += 6) {
        await Promise.all(entries.slice(offset, offset + 6).map(async ([id, lastPublished]) => {
            if (!hashPattern.test(id) || typeof lastPublished !== 'string'
                || !Number.isFinite(Date.parse(lastPublished)) || Date.parse(lastPublished) > now.getTime()) {
                throw new Error('Invalid toolbar archive entry');
            }
            if (id === currentHash || now.getTime() - Date.parse(lastPublished) > year) return;
            const name = `${id}.js`;
            const saved = retainFrom ? await download(new URL(`/toolbar/${name}`, retainFrom), 750_000)
                : await readFile(join(directory, name));
            if (!saved || hash(saved) !== id) throw new Error(`Toolbar archive hash mismatch: ${id}`);
            await writeFile(join(directory, name), saved);
            bundles[id] = lastPublished;
        }));
    }
    await writeFile(join(publicDir, 'toolbar.js'), bytes);
    await writeFile(join(directory, `${currentHash}.js`), bytes);
    // Also remove expired local outputs so repeat builds cannot publish them accidentally.
    for (const name of await readdir(directory)) {
        if (/^[a-f0-9]{64}\.js$/.test(name) && !Object.hasOwn(bundles, name.slice(0, -3))) await unlink(join(directory, name));
    }
    const current = { path: `/toolbar/${currentHash}.js`, integrity: `sha384-${createHash('sha384').update(bytes).digest('base64')}` };
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ version: 1, current, bundles }));
    return current;
}
