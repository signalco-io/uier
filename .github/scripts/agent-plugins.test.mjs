import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pluginPath, repoRoot, syncAgentPlugin } from './agent-plugins.mjs';

test('cached plugin works without repository skill aliases or dependencies', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'uier-plugin-cache-'));
    try {
        await cp(join(repoRoot, pluginPath), temp, { recursive: true });
        const manifest = JSON.parse(await readFile(join(temp, '.claude-plugin/plugin.json'), 'utf8'));
        assert.equal(manifest.name, JSON.parse(await readFile(join(temp, 'plugin.json'), 'utf8')).name);
        const monitor = join(temp, 'skills/uier-monitor/scripts/monitor.mjs');
        const installed = JSON.parse(execFileSync(process.execPath, [monitor, 'version'], { encoding: 'utf8', cwd: temp }));
        const fallback = await readFile(join(temp, 'skills/uier-monitor-script/SKILL.md'), 'utf8');
        // This is the extraction used by the fallback skill, exercised after the package is copied.
        const embedded = fallback.split('<!-- monitor.mjs:begin -->\n````js\n')[1]?.split('````\n<!-- monitor.mjs:end -->')[0];
        assert.equal(embedded, await readFile(monitor, 'utf8'));
        await writeFile(join(temp, 'restored.mjs'), embedded);
        const restored = JSON.parse(execFileSync(process.execPath, [join(temp, 'restored.mjs'), 'version'], { encoding: 'utf8', cwd: temp }));
        assert.deepEqual(restored, installed);
        execFileSync(process.execPath, [join(temp, 'skills/uier-monitor/scripts/build-script-skill.mjs'), '--check'], { cwd: temp });
    } finally { await rm(temp, { recursive: true, force: true }); }
});

test('drift check rejects an edited adapter and an escaping packaged symlink', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'uier-plugin-drift-'));
    try {
        // A small isolated repository fixture keeps mutations away from the actual package.
        for (const path of [pluginPath, '.agents', '.claude', 'LICENSE', 'apps/web/public/android-chrome-192x192.png'])
            await cp(join(repoRoot, path), join(temp, path), { recursive: true, verbatimSymlinks: true });
        await syncAgentPlugin(temp);
        await syncAgentPlugin(temp, { check: true });
        await writeFile(join(temp, pluginPath, '.mcp.json'), '{}\n');
        await assert.rejects(syncAgentPlugin(temp, { check: true }), /\.mcp\.json is out of date/);
        await syncAgentPlugin(temp);
        await symlink(repoRoot, join(temp, pluginPath, 'outside'));
        await assert.rejects(syncAgentPlugin(temp, { check: true }), /must not contain symlinks/);
    } finally { await rm(temp, { recursive: true, force: true }); }
});
