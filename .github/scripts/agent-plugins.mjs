// The portable manifest and MCP config are canonical. Generate the host-specific adapters,
// catalogs, license and icon; --check is the dependency-free CI drift/containment check.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const pluginPath = 'plugins/uier';
const skillNames = ['uier-monitor', 'uier-monitor-script'];

export async function syncAgentPlugin(root = repoRoot, { check = false } = {}) {
    const plugin = join(root, pluginPath);
    const manifest = JSON.parse(await readFile(join(plugin, 'plugin.json'), 'utf8'));
    const mcp = JSON.parse(await readFile(join(plugin, 'mcp.json'), 'utf8'));
    assert.equal(manifest.name, 'uier');
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
    assert.equal(mcp.mcpServers.uier.type, 'streamable-http');
    assert.equal(mcp.mcpServers.uier.url, 'https://uier.io/api/mcp');
    const { $schema, extensions, ...identity } = manifest;
    const listing = extensions['com.openai'].interface;
    assert.equal($schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
    const generated = new Map([
        [`${pluginPath}/.claude-plugin/plugin.json`, {
            ...identity, displayName: listing.displayName, icon: listing.logo,
            documentationUrl: 'https://github.com/signalco-io/uier/blob/main/docs/agent-plugins.md',
            supportUrl: listing.supportURL, privacyPolicyUrl: listing.privacyPolicyURL, termsOfServiceUrl: listing.termsOfServiceURL,
        }],
        [`${pluginPath}/.mcp.json`, { mcpServers: { uier: { type: 'http', url: mcp.mcpServers.uier.url } } }],
        ['.claude-plugin/marketplace.json', {
            name: manifest.name, description: manifest.description, owner: manifest.author,
            plugins: [{ name: manifest.name, source: `./${pluginPath}` }],
        }],
        ['.agents/plugins/marketplace.json', {
            name: manifest.name, interface: { displayName: manifest.name },
            plugins: [{ name: manifest.name, source: { source: 'local', path: `./${pluginPath}` },
                policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Developer Tools' }],
        }],
    ].map(([path, value]) => [path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`)]));
    generated.set(`${pluginPath}/LICENSE`, await readFile(join(root, 'LICENSE')));
    generated.set(`${pluginPath}/assets/icon.png`, await readFile(join(root, 'apps/web/public/android-chrome-192x192.png')));
    for (const [path, expected] of generated) {
        const target = join(root, path);
        if (check) {
            const actual = await readFile(target).catch(() => null);
            assert.ok(actual?.equals(expected), `${path} is out of date. Run: node .github/scripts/agent-plugins.mjs`);
        } else {
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, expected);
        }
    }

    // Repository discovery uses aliases; cached installs must not need anything outside the plugin.
    for (const name of skillNames) {
        const canonical = await realpath(join(plugin, 'skills', name));
        for (const host of ['.claude', '.agents'])
            assert.equal(await realpath(join(root, host, 'skills', name)), canonical, `${host}/skills/${name} must point to the packaged skill`);
    }
    assert.deepEqual((await readdir(join(plugin, 'skills'))).sort(), skillNames);
    await assertContained(plugin);
}

async function assertContained(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        assert.ok(!entry.isSymbolicLink(), `Packaged plugins must not contain symlinks: ${path}`);
        if (entry.isDirectory()) await assertContained(path);
        else assert.ok(entry.isFile(), `Unexpected plugin entry: ${path}`);
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await syncAgentPlugin(repoRoot, { check: process.argv.includes('--check') });
    console.log(`uier plugin ${process.argv.includes('--check') ? 'checked' : 'generated'}.`);
}
