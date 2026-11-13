import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { nextVersion, plan, pullRequestBody, recordedVersions, setVersion } from './release-plan.mjs';

const repository = resolve(import.meta.dirname, '../../..');

test('every recorded version on this branch is the same', () => {
    const versions = recordedVersions(repository);
    assert.equal(new Set(versions).size, 1, `Versions differ: ${versions.join(', ')}`);
});

test('a release is due only after shipped source changes and never skips an untagged version', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'uier-release-plan-'));
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const write = (path, text) => { mkdirSync(resolve(root, path, '..'), { recursive: true }); writeFileSync(resolve(root, path), text); };
    const commit = message => { git('add', '.'); git('commit', '-m', message); };
    try {
        git('init', '-b', 'main'); git('config', 'user.name', 'Local release test'); git('config', 'user.email', 'release@example.test');
        for (const app of ['extension', 'extension-firefox']) write(`apps/${app}/package.json`, '{\n  "name": "app",\n  "version": "0.1.4",\n  "private": true\n}\n');
        write('apps/web/src/lib/extension/release.ts', "export const latestExtensionVersion = '0.1.4';\n");
        write('packages/toolbar/src/index.ts', 'export {};\n');
        commit('Initial'); git('tag', 'extension-v0.1.4'); git('tag', 'extension-v0.1.10-broken');
        assert.equal(plan(root).state, 'current');
        assert.deepEqual({ ...plan(root, { force: true }), changes: [] }, { state: 'due', version: '0.1.5', tag: 'extension-v0.1.4', changes: [] });

        write('docs/notes.md', 'Not shipped.\n'); commit('docs: notes');
        assert.equal(plan(root).state, 'current');
        write('packages/extension/src/worker.ts', 'export {};\n'); commit('fix(extension): transport only');
        write('packages/toolbar/docs/notes.md', 'Toolbar documentation only.\n'); commit('docs(toolbar): notes');
        write('pnpm-lock.yaml', 'Dependency-only update.\n'); commit('chore(deps): update');
        assert.equal(plan(root).state, 'current');
        write('packages/toolbar/src/index.ts', 'export const value = 1;\n'); commit('feat(toolbar): temporary change');
        write('packages/toolbar/src/index.ts', 'export {};\n'); commit('revert: temporary toolbar change');
        assert.equal(plan(root).state, 'current', 'A reverted toolbar change must not produce an empty release');
        write('packages/toolbar/src/index.ts', 'export const value = 1;\n'); commit('feat(toolbar): ship a change');
        const due = plan(root);
        assert.equal(due.state, 'due'); assert.equal(due.version, '0.1.5');
        assert.match(due.changes.join('\n'), /feat\(toolbar\): ship a change/);
        assert.doesNotMatch(due.changes.join('\n'), /docs: notes/);
        assert.match(pullRequestBody(due), /After it passes.*merges it, creates the immutable release tag/);

        setVersion(root, '0.1.5');
        assert.deepEqual(recordedVersions(root), ['0.1.5', '0.1.5', '0.1.5']);
        assert.match(readFileSync(resolve(root, 'apps/extension/package.json'), 'utf8'), /^\{\n {2}"name": "app",\n {2}"version": "0\.1\.5",\n/);
        commit('chore(extension): release 0.1.5');
        assert.deepEqual({ ...plan(root), changes: [] }, { state: 'untagged', version: '0.1.5', tag: 'extension-v0.1.4', changes: [] });
        git('tag', 'extension-v0.1.5');
        assert.equal(plan(root).state, 'current');

        write('apps/web/src/lib/extension/release.ts', "export const latestExtensionVersion = '0.1.4';\n");
        assert.throws(() => plan(root), /Versions differ/);
        for (const version of ['0.0.0', '01.2.3', '1.2', '65536.0.0', "1.2.3'; alert(1)"]) assert.throws(() => setVersion(root, version));
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('version increments remain within browser-store numeric limits', () => {
    assert.equal(nextVersion('0.1.5'), '0.1.6');
    assert.equal(nextVersion('0.1.65535'), '0.2.0');
    assert.equal(nextVersion('0.65535.65535'), '1.0.0');
    assert.throws(() => nextVersion('65535.65535.65535'), /exhausted/);
});
