import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { releaseGate, releaseVersion, sourceArchive, releaseJournal, digest } from './release.mjs';

test('publishing requires the repository, protected ref, browser flag and native evidence', () => {
    const valid = { GITHUB_REPOSITORY: 'signalco-io/uier', RELEASE_REF_PROTECTED: 'true', FIREFOX_PUBLISHING_ENABLED: 'true', HOSTED_ACCEPTANCE_URL: 'https://github.com/signalco-io/uier/issues/123#issuecomment-456' };
    releaseGate('firefox', valid);
    for (const key of Object.keys(valid)) assert.throws(() => releaseGate('firefox', { ...valid, [key]: '' }));
    assert.throws(() => releaseGate('safari', valid));
    assert.equal(releaseVersion('extension-v0.1.3'), '0.1.3');
    for (const tag of ['main', 'v0.1.3', 'extension-v0.1.3;false']) assert.throws(() => releaseVersion(tag));
});
test('reviewer source is reproducible committed content and excludes local credentials', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'uier-source-test-'));
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    try {
        git('init', '-b', 'main'); git('config', 'user.name', 'Source test'); git('config', 'user.email', 'source@example.test');
        await writeFile(resolve(root, 'package.json'), '{"name":"source-fixture"}'); await writeFile(resolve(root, '.gitignore'), '.env.local\n');
        await mkdir(resolve(root, 'packages/extension'), { recursive: true });
        await writeFile(resolve(root, 'pnpm-lock.yaml'), 'committed-lockfile');
        await writeFile(resolve(root, 'packages/extension/package.json'), '{"name":"nested"}');
        git('add', '.'); git('commit', '-m', 'Committed source');
        await writeFile(resolve(root, '.env.local'), 'never-upload-this'); await writeFile(resolve(root, 'untracked-key.p8'), 'untracked-private-key');
        const result = await sourceArchive({ directory: resolve(root, 'release'), version: '0.1.3', cwd: resolve(root, 'packages/extension') });
        const first = await readFile(result.file);
        assert.equal(digest(first), result.sha256);
        const files = execFileSync('unzip', ['-Z1', result.file], { encoding: 'utf8' });
        assert(!/env\.local|untracked-key/.test(files));
        assert(files.includes('pnpm-lock.yaml')); assert(files.includes('packages/extension/package.json'));
        await sourceArchive({ directory: resolve(root, 'release'), version: '0.1.3', cwd: root });
        assert.deepEqual(await readFile(result.file), first);
    } finally { await rm(root, { recursive: true, force: true }); }
});
test('retained binary ZIPs are compared as bytes and cannot be overwritten on rerun', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'uier-journal-test-'));
    const name = 'uier-extension-firefox-0.1.3.zip';
    const zip = Buffer.from([0, 255, 128, 254, 17]);
    const files = { [name]: zip, [`${name}.json`]: Buffer.from('{}'), [`${name}.sha256`]: Buffer.from(digest(zip)) };
    const writes = [];
    const gh = (...args) => {
        if (args[0] === 'api') return JSON.stringify([{ tag_name: 'extension-v0.1.3', draft: true }]);
        if (args[1] === 'view') return JSON.stringify({ assets: Object.keys(files).map(name => ({ name })) });
        if (args[1] === 'download') return files[args[args.indexOf('--pattern') + 1]];
        if (args[1] === 'upload') { writes.push(args); return ''; }
        throw new Error(`Unexpected ${args.join(' ')}`);
    };
    try {
        for (const [name, bytes] of Object.entries(files)) await writeFile(resolve(root, name), bytes);
        const options = { directory: root, tag: 'extension-v0.1.3', browser: 'firefox', artifact: { name, sha256: digest(zip), commit: 'a'.repeat(40) }, gh };
        const journal = await releaseJournal(options);
        assert.equal(writes.length, 0);
        await journal.checkpoint({ phase: 'upload-started' });
        assert(writes[0].includes('--clobber')); // Mutable receipt only.
        await writeFile(resolve(root, name), 'changed');
        await assert.rejects(releaseJournal(options), /differs/);
        assert.equal(writes.length, 1);
    } finally { await rm(root, { recursive: true, force: true }); }
});
