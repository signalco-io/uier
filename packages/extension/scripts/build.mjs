import { build } from 'esbuild';
import { readFile, writeFile, mkdir, cp, rm, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { createHash } from 'node:crypto';
import { createManifest } from './manifest.mjs';
import { brand, MARK_PATH } from '../../../packages/brand/src/brand.ts';
const sharedRoot = resolve(import.meta.dirname, '..');
export async function buildExtension({ root, browser = 'chrome', test = process.argv.includes('--test'), hostedTest = process.argv.includes('--hosted-test') }) {
if (!['chrome', 'firefox'].includes(browser)) throw new Error('Unknown browser target.');
if (test && hostedTest) throw new Error('Choose one test API.');
const dest = resolve(root, test ? 'dist-test' : hostedTest ? 'dist-hosted-test' : 'dist');
await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const testPort = Number(process.env.PORT || 4004);
if (test && (!Number.isInteger(testPort) || testPort < 1 || testPort > 65535)) throw new Error('Use a valid local test PORT.');
const api = test ? `http://127.0.0.1:${testPort}` : 'https://uier.io';
const css = await readFile(resolve(root, '../../packages/toolbar/dist/index.css'), 'utf8');
for (const [name, entry] of Object.entries({ worker: 'worker.ts', content: 'content.ts', popup: 'popup.tsx', helper: 'helper.ts' })) {
    await build({ entryPoints: [resolve(sharedRoot, 'src', entry)], outfile: resolve(dest, `${name}.js`), bundle: true,
        format: browser === 'chrome' && name === 'worker' ? 'esm' : 'iife', platform: 'browser', target: browser === 'chrome' ? 'chrome120' : 'firefox153', minify: true,
        alias: { 'next/link': resolve(root, '../../packages/toolbar/src/components/ToolbarLink.tsx') },
        define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}', __UIER_API_URL__: JSON.stringify(api), __UIER_DEV__: 'false', __EXTENSION_API__: JSON.stringify(api), __EXTENSION_BROWSER__: JSON.stringify(browser),
            // No remote scripts in packaged clients: the toolbar's accessibility audit is not available here
            __UIER_AUDIT_PATH__: '""', __UIER_AUDIT_INTEGRITY__: '""' },
        plugins: [{ name: 'packaged-css', setup(b) {
            // The embed runtime imports CSS for tsup; packaged clients use its compiled sheet.
            b.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }));
            b.onEnd(async () => {
            const path = resolve(dest, `${name}.js`);
            const js = await readFile(path, 'utf8');
            await writeFile(path, js.replace(/(["'])__uier_toolbar_css__\1/g, () => JSON.stringify(css)));
        }); } }]
    });
}
// Extension pages get their own sheet: the toolbar's Tailwind setup and brand tokens, plus the
// classes used in src/, with Geist packaged next to it (no remote fonts or styles).
const pageCss = resolve(sharedRoot, 'src/popup.css');
const compiled = await postcss([tailwindcss({ base: resolve(sharedRoot, 'src'), optimize: { minify: true } })])
    .process(await readFile(pageCss, 'utf8'), { from: pageCss, to: resolve(dest, 'popup.css') });
await writeFile(resolve(dest, 'popup.css'), compiled.css);
const geist = dirname(createRequire(import.meta.url).resolve('geist/font'));
await mkdir(resolve(dest, 'fonts'));
for (const [from, to] of [['fonts/geist-sans/Geist-Variable.woff2', 'geist.woff2'], ['fonts/geist-mono/GeistMono-Variable.woff2', 'geist-mono.woff2'], ['../LICENSE.txt', 'LICENSE.txt']])
    await copyFile(resolve(geist, from), resolve(dest, 'fonts', to));
for (const page of ['popup', 'helper']) await writeFile(resolve(dest, `${page}.html`), `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>uier</title><link rel="stylesheet" href="popup.css"></head><body><div id="root" data-uier-root></div><script src="${page}.js"></script></body></html>`);
const manifest = createManifest({ browser, api, version: pkg.version });
if (browser === 'chrome' && (test || hostedTest)) {
    // Public development key only. Stable test ID; never a signing key or store identity.
    manifest.key = (await readFile(resolve(root, 'development-key.txt'), 'utf8')).trim();
    const hash = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
    const id = hash.replace(/[0-9a-f]/g, n => String.fromCharCode(97 + parseInt(n, 16)));
    await writeFile(resolve(dest, 'development-id.txt'), id);
}
// The app icon (BRAND.md, "App icon") with its 22 % radius drawn in, because browsers do not mask
// extension icons. The 128 px store/install icon keeps Chrome's 16 px transparent padding.
await mkdir(resolve(dest, 'icons'));
for (const [size, inset] of [[16, 0], [32, 0], [48, 0], [128, 16]]) {
    const side = size - inset * 2, mark = side * 0.54, offset = inset + (side - mark) / 2 + side * 0.015;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect x="${inset}" y="${inset}" width="${side}" height="${side}" rx="${side * 0.22}" fill="${brand.colors.black}"/><g transform="translate(${offset} ${offset}) scale(${mark / 24})"><path fill="${brand.colors.paper}" d="${MARK_PATH}"/></g></svg>`;
    await sharp(Buffer.from(svg), { density: 72 * 8 }).resize(size, size).png().toFile(resolve(dest, `icons/${size}.png`));
}
await writeFile(resolve(dest, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await cp(resolve(root, '../../LICENSE'), resolve(dest, 'LICENSE'));
}
