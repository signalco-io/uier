import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Script } from 'node:vm';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..');
export async function validate(directory = resolve(root, 'dist')) {
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, pkg.version);
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
    assert(manifest.version.split('.').every(n => Number(n) <= 65535));
    assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage', 'identity']);
    assert.deepEqual(manifest.host_permissions, ['https://uier.io/*']);
    assert(!manifest.key && !manifest.content_scripts && !manifest.externally_connectable && !manifest.web_accessible_resources);
    assert(!/unsafe-eval|https:;|\*/.test(manifest.content_security_policy.extension_pages));
    const files = [];
    async function visit(dir, prefix = '') {
        for (const name of await readdir(dir)) {
            const path = join(dir, name), relative = `${prefix}${name}`;
            if ((await stat(path)).isDirectory()) await visit(path, `${relative}/`);
            else files.push(relative);
        }
    }
    await visit(directory);
    const required = ['worker.js', 'content.js', 'popup.js', 'helper.js', 'popup.html', 'helper.html', 'popup.css', 'LICENSE', ...Object.values(manifest.icons)];
    for (const file of required) assert(files.includes(file), `Missing packaged file ${file}`);
    for (const file of files.filter(f => /\.(js|html|css)$/.test(f))) {
        const text = await readFile(join(directory, file), 'utf8');
        assert(!/__uier_toolbar_css__|__EXTENSION_API__|__UIER_API_URL__/.test(text), `Unresolved build marker: ${file}`);
        assert(!/(?:https?:\/\/)(?:localhost|127\.0\.0\.1)(?::4004)?(?:["'/])/.test(text), `Development API in ${file}`);
        assert(!/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|(?:ghp_|github_pat_|AKIA)[A-Za-z0-9_]{20,}/.test(text), `Possible secret in ${file}`);
        assert(!/(?:import\s*\(|importScripts\s*\(|src\s*=\s*)["'`]https?:\/\//.test(text), `Remote executable load in ${file}`);
        assert(!/https:\/\/uier.io\/(?:toolbar\.js|toolbar\/[a-f0-9]+\.js)/.test(text), `Remote toolbar in ${file}`);
        if (file.endsWith('.js') && file !== 'worker.js') new Script(text);
        if (file.endsWith('.html')) assert(!/<script\b[^>]*src=["']https?:/i.test(text));
    }
    return { manifest, files: files.sort() };
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
    const result = await validate();
    console.log(`Validated uier ${result.manifest.version}: ${result.files.length} packaged resources`);
}
