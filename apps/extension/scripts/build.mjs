import { build } from 'esbuild';
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
const test = process.argv.includes('--test');
const hostedTest = process.argv.includes('--hosted-test');
const root = resolve(import.meta.dirname, '..');
const dest = resolve(root, test ? 'dist-test' : hostedTest ? 'dist-hosted-test' : 'dist');
await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const api = test ? 'http://127.0.0.1:4004' : 'https://uier.io';
const css = await readFile(resolve(root, '../../packages/toolbar/dist/index.css'), 'utf8');
for (const [name, entry] of Object.entries({ worker: 'worker.ts', content: 'content.ts', popup: 'popup.tsx', helper: 'helper.ts' })) {
    await build({ entryPoints: [resolve(root, 'src', entry)], outfile: resolve(dest, `${name}.js`), bundle: true,
        format: name === 'worker' ? 'esm' : 'iife', platform: 'browser', target: 'chrome120', minify: true,
        alias: { 'next/link': resolve(root, '../../packages/toolbar/src/components/ToolbarLink.tsx') },
        define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}', __UIER_API_URL__: JSON.stringify(api), __UIER_DEV__: 'false', __EXTENSION_API__: JSON.stringify(api) },
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
await writeFile(resolve(dest, 'popup.css'), css);
for (const page of ['popup', 'helper']) await writeFile(resolve(dest, `${page}.html`), `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>uier</title>${page === 'popup' ? '<link rel="stylesheet" href="popup.css">' : ''}</head><body><div id="root"></div><script src="${page}.js"></script></body></html>`);
const manifest = {
    manifest_version: 3, name: 'uier', version: pkg.version, minimum_chrome_version: '120',
    description: 'Review configured project sites with uier. Signed-in project membership required.',
    permissions: ['activeTab', 'scripting', 'storage', 'identity'], host_permissions: [`${api}/*`],
    background: { service_worker: 'worker.js', type: 'module' }, action: { default_popup: 'popup.html', default_title: 'uier' },
    commands: { _execute_action: { suggested_key: { default: 'Alt+Shift+U' }, description: 'Open uier' } },
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
    content_security_policy: { extension_pages: `script-src 'self'; object-src 'none'; frame-src ${api}; connect-src ${api}; style-src 'self' 'unsafe-inline'; img-src 'self' data:;` }
};
if (test || hostedTest) {
    // Public development key only. Stable test ID; never a signing key or store identity.
    manifest.key = (await readFile(resolve(root, 'development-key.txt'), 'utf8')).trim();
    const hash = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
    const id = hash.replace(/[0-9a-f]/g, n => String.fromCharCode(97 + parseInt(n, 16)));
    await writeFile(resolve(dest, 'development-id.txt'), id);
}
await mkdir(resolve(dest, 'icons'));
for (const size of [16, 32, 48, 128]) {
    await sharp(resolve(root, '../../packages/brand/assets/mark.svg'), { density: 384 }).resize(size, size).png().toFile(resolve(dest, `icons/${size}.png`));
}
await writeFile(resolve(dest, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await cp(resolve(root, '../../LICENSE'), resolve(dest, 'LICENSE'));
