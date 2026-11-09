import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

test('release resolver requires an exact versioned tag on main and rejects moved tags', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'uier-release-ref-'));
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const check = (tag, commit) => spawnSync(process.execPath, [resolve(import.meta.dirname, 'resolve-release.mjs')], { cwd: root, encoding: 'utf8', env: { ...process.env, RELEASE_TAG: tag, RELEASE_COMMIT: commit ?? '', GITHUB_OUTPUT: '' } });
    try {
        git('init', '-b', 'main'); git('config', 'user.name', 'Local release test'); git('config', 'user.email', 'release@example.test');
        for (const app of ['extension', 'extension-firefox']) {
            mkdirSync(resolve(root, `apps/${app}`), { recursive: true });
            writeFileSync(resolve(root, `apps/${app}/package.json`), '{"version":"0.1.0"}');
        }
        git('add', '.'); git('commit', '-m', 'Initial');
        const main = git('rev-parse', 'HEAD'); git('update-ref', 'refs/remotes/origin/main', main); git('tag', 'extension-v0.1.0');
        assert.equal(check('extension-v0.1.0', main).status, 0);
        assert.notEqual(check('extension-v0.1.0', 'f'.repeat(40)).status, 0);
        git('tag', 'extension-v0.2.0'); assert.notEqual(check('extension-v0.2.0').status, 0);
        git('checkout', '-b', 'unmerged'); writeFileSync(resolve(root, 'apps/extension/package.json'), '{"version":"0.3.0"}'); git('add', '.'); git('commit', '-m', 'Unmerged'); git('tag', 'extension-v0.3.0');
        assert.notEqual(check('extension-v0.3.0').status, 0);
        for (const tag of ['main', 'extension-v0.0.0', 'extension-v01.0.0', 'extension-v65536.0.0', 'extension-v1.2.3;false']) assert.notEqual(check(tag).status, 0);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
