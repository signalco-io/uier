import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const config = JSON.parse(await readFile(resolve(root, '.github/indexnow.json'), 'utf8'));
const origin = `https://${config.host}`;
const sha256 = value => createHash('sha256').update(value).digest('hex');
// Next's generated social-card URLs include a build-dependent cache key.
const stableAsset = value => value.replace(/(opengraph-image(?:\.png)?)(?:\?[^"\s<]*)/gi, '$1');

export function publicUrl(value) {
    const url = new URL(value);
    if (url.origin !== origin || url.search || url.hash || url.username || url.password
        || !/^\/(?:[a-z0-9-]+\/)*[a-z0-9-]*$/.test(url.pathname)
        || /^\/(?:api|app|og|notifications|review-session|review-verification|extension-verification)(?:\/|$)/.test(url.pathname))
        throw new Error('Search manifest contains a non-public URL');
    return url.href;
}

/** Search content, excluding build IDs, CSS and framework bootstrap payloads. */
export function contentHash(html) {
    const structured = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
        .map(match => JSON.stringify(JSON.parse(match[1])));
    const clean = html.replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    const body = clean.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? clean;
    const text = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const links = [...body.matchAll(/\b(?:href|src|alt)="([^"]*)"/g)].map(match => stableAsset(match[1]));
    const metadata = [...clean.matchAll(/<title>([\s\S]*?)<\/title>|<meta\b[^>]*(?:name|property)="(?:description|og:[^"]+|twitter:[^"]+)"[^>]*>/gi)]
        .map(match => stableAsset(match[0]));
    return sha256(JSON.stringify({ text, links, metadata, structured }));
}

export function validateManifest(value) {
    if (!value || value.version !== 1 || !/^[a-f0-9]{40}$/.test(value.revision)
        || !Array.isArray(value.pages) || !value.pages.length || value.pages.length > 10_000)
        throw new Error('Invalid search manifest');
    const seen = new Set();
    for (const page of value.pages) {
        const url = publicUrl(page.url);
        if (!/^[a-f0-9]{64}$/.test(page.hash) || seen.has(url)) throw new Error('Invalid search manifest page');
        seen.add(url);
    }
    return value;
}

export function changedUrls(previous, current) {
    validateManifest(current);
    if (previous) validateManifest(previous);
    const old = new Map((previous?.pages ?? []).map(page => [publicUrl(page.url), page.hash]));
    const next = new Map(current.pages.map(page => [publicUrl(page.url), page.hash]));
    return [...new Set([...old.keys(), ...next.keys()])].filter(url => old.get(url) !== next.get(url)).sort();
}

async function readPublished(fetcher = fetch) {
    const response = await fetcher(`${origin}/search-index.json`, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Search manifest fetch failed: HTTP ${response.status}`);
    const text = await response.text();
    if (Buffer.byteLength(text) > 1_000_000) throw new Error('Search manifest is too large');
    return validateManifest(JSON.parse(text));
}

export async function generate() {
    const publicDir = resolve(root, 'apps/web/public');
    const index = await readFile(resolve(publicDir, 'sitemap.xml'), 'utf8');
    const pages = [];
    for (const match of index.matchAll(/<loc>([^<]+)<\/loc>/g)) {
        const child = new URL(match[1]);
        if (child.origin !== origin || !/^\/sitemap(?:-\d+)?\.xml$/.test(child.pathname)) throw new Error('Invalid sitemap index');
        const xml = await readFile(resolve(publicDir, child.pathname.slice(1)), 'utf8');
        for (const entry of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
            const url = publicUrl(entry[1]);
            const path = new URL(url).pathname;
            try {
                const html = await readFile(resolve(root, `apps/web/.next/server/app/${path === '/' ? 'index' : path.slice(1)}.html`), 'utf8');
                if (/<meta\b[^>]*name="robots"[^>]*content="[^"]*noindex/i.test(html)) continue;
                pages.push({ url, hash: contentHash(html) });
            } catch (error) {
                // Dynamic status pages remain discoverable through the sitemap. Live health is not a content update.
                if (error.code !== 'ENOENT' || path !== '/status') throw error;
            }
        }
    }
    const revision = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const manifest = validateManifest({ version: 1, revision, pages: pages.sort((a, b) => a.url.localeCompare(b.url)) });
    await writeFile(resolve(publicDir, 'search-index.json'), `${JSON.stringify(manifest)}\n`);
    console.log(`Search manifest: ${pages.length} static public pages`);
}

export async function submit(previous, current, revision, fetcher = fetch) {
    if (current.revision !== revision) throw new Error('Production is serving another commit; no URLs submitted');
    const urls = changedUrls(previous, current);
    if (!urls.length) return { status: 'unchanged', count: 0 };
    const key = await fetcher(config.keyLocation, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!key.ok || (await key.text()).trim() !== config.key) throw new Error('Published IndexNow key does not match');
    const response = await fetcher('https://api.indexnow.org/indexnow', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ ...config, urlList: urls })
    });
    if (response.status !== 200 && response.status !== 202) throw new Error(`IndexNow submission failed: HTTP ${response.status}`);
    return { status: response.status === 200 ? 'submitted' : 'key-validation-pending', count: urls.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [command, filename] = process.argv.slice(2);
    if (command === 'generate') await generate();
    else if (command === 'capture' && filename) await writeFile(filename, `${JSON.stringify(await readPublished())}\n`);
    else if (command === 'submit' && filename) {
        const current = await readPublished();
        if (!current) throw new Error('Production search manifest is missing');
        console.log(JSON.stringify(await submit(JSON.parse(await readFile(filename, 'utf8')), current, process.env.GITHUB_SHA)));
    } else throw new Error('Expected generate, capture <file>, or submit <file>');
}
