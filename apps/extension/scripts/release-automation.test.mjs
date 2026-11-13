import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { releaseBranchVersion, validateCi, validatePullRequest, validateVersionChange } from './release-automation.mjs';
import { setVersion, versionPaths } from './release-plan.mjs';

const sha = 'a'.repeat(40), repository = 'signalco-io/uier', version = '0.1.6';
const pr = { user: { login: 'github-actions[bot]' }, head: { repo: { full_name: repository }, ref: `extension-release/v${version}`, sha },
    base: { repo: { full_name: repository }, ref: 'main' }, draft: false, commits: 1, state: 'open', merged: false };
const ci = { path: '.github/workflows/ci.yml', event: 'workflow_dispatch', head_repository: { full_name: repository },
    head_branch: pr.head.ref, head_sha: sha, status: 'completed', conclusion: 'success' };

test('only the repository bot single-commit version PR qualifies for automatic merging', () => {
    assert.equal(releaseBranchVersion(pr.head.ref), version);
    validatePullRequest(pr, version);
    validatePullRequest({ ...pr, state: 'closed', merged: true }, version);
    for (const change of [{ user: { login: 'someone' } }, { commits: 2 }, { draft: true }, { state: 'closed' },
        { head: { ...pr.head, repo: { full_name: 'fork/uier' } } }, { base: { ...pr.base, ref: 'other' } }])
        assert.throws(() => validatePullRequest({ ...pr, ...change }, version));
    for (const branch of ['main', 'extension-release/v01.2.3', 'extension-release/v1.2.3;false'])
        assert.throws(() => releaseBranchVersion(branch));
});

test('CI from another head, workflow, repository or event cannot release a version', () => {
    const expected = { branch: pr.head.ref, sha };
    validateCi(ci, expected);
    for (const change of [{ head_sha: 'b'.repeat(40) }, { head_branch: 'main' }, { path: '.github/workflows/other.yml' },
        { event: 'pull_request' }, { head_repository: { full_name: 'fork/uier' } }, { conclusion: 'failure' }, { status: 'in_progress' }])
        assert.throws(() => validateCi({ ...ci, ...change }, expected));
});

test('committed release candidates contain exactly the version edits; unchanged daily runs make no GitHub calls', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'uier-release-automation-'));
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const write = (path, text) => { mkdirSync(resolve(root, path, '..'), { recursive: true }); writeFileSync(resolve(root, path), text); };
    const commit = message => { git('add', '.'); git('commit', '-m', message); return git('rev-parse', 'HEAD'); };
    try {
        git('init', '-b', 'main'); git('config', 'user.name', 'Release fixture'); git('config', 'user.email', 'release@example.test');
        for (const app of ['extension', 'extension-firefox']) write(`apps/${app}/package.json`, '{\n  "version": "0.1.5",\n  "private": true\n}\n');
        write('apps/web/src/lib/extension/release.ts', "export const latestExtensionVersion = '0.1.5';\n");
        write('packages/toolbar/src/index.ts', 'export {};\n');
        const base = commit('Initial'); git('tag', 'extension-v0.1.5');
        // Any accidental call fails the child run, independently of the caller's real credentials.
        mkdirSync(resolve(root, 'bin'));
        writeFileSync(resolve(root, 'bin/gh'), '#!/bin/sh\nexit 99\n', { mode: 0o700 });
        const result = spawnSync(process.execPath, [resolve(import.meta.dirname, 'release-automation.mjs'), 'prepare'], {
            cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`,
                GITHUB_REPOSITORY: repository, GITHUB_REF: 'refs/heads/main', GITHUB_STEP_SUMMARY: '', GITHUB_OUTPUT: '', FORCE: '' },
        });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /No version bump or release/);
        rmSync(resolve(root, 'bin'), { recursive: true });

        setVersion(root, version);
        const candidate = commit('chore(extension): release 0.1.6');
        validateVersionChange(root, base, candidate, version);
        // Exercise the actual privileged CLI with local git and a GitHub API fixture. It must
        // check the exact CI head before issuing the SHA-guarded merge, and emit that merge's tag.
        git('remote', 'add', 'origin', root);
        const support = resolve(root, '.git/release-fixture');
        mkdirSync(resolve(support, 'bin'), { recursive: true });
        const state = { pr: { ...pr, number: 7, head: { ...pr.head, sha: candidate }, merge_commit_sha: candidate,
            html_url: 'https://github.com/signalco-io/uier/pull/7' }, calls: [] };
        writeFileSync(resolve(support, 'state.json'), JSON.stringify(state));
        writeFileSync(resolve(support, 'event.json'), JSON.stringify({ workflow_run: { ...ci, head_sha: candidate } }));
        writeFileSync(resolve(support, 'bin/gh'), `#!${process.execPath}
const fs = require('node:fs');
const file = process.env.FIXTURE_STATE, state = JSON.parse(fs.readFileSync(file));
const args = process.argv.slice(2), prefix = 'repos/signalco-io/uier/';
state.calls.push(args);
let result;
if (args[0] !== 'api') throw Error('Unexpected GitHub mutation');
if (args[1] === '--method') {
    if (args.join(' ') !== 'api --method PUT ' + prefix + 'pulls/7/merge -f sha=' + state.pr.head.sha + ' -f merge_method=squash') throw Error('Merge was not guarded by SHA');
    state.pr.merged = true; state.pr.state = 'closed'; result = { merged: true };
} else {
    const path = args[1].slice(prefix.length);
    if (path.startsWith('pulls?')) result = [state.pr];
    else if (path === 'pulls/7') result = state.pr;
    else if (path === 'pulls/7/files?per_page=100') result = ${JSON.stringify(versionPaths)}.map(filename => ({ filename }));
    else if (path.startsWith('commits/')) result = { check_runs: [{ name: 'CI OK', app: { id: 15368 }, head_sha: state.pr.head.sha, conclusion: 'success' }] };
    else throw Error('Unexpected API read: ' + path);
}
fs.writeFileSync(file, JSON.stringify(state));
process.stdout.write(JSON.stringify(result));
`, { mode: 0o700 });
        const finishEnv = { ...process.env, PATH: `${support}/bin:${process.env.PATH}`, FIXTURE_STATE: resolve(support, 'state.json'),
            GITHUB_REPOSITORY: repository, GITHUB_REF: 'refs/heads/main', GITHUB_STEP_SUMMARY: '',
            GITHUB_EVENT_PATH: resolve(support, 'event.json'), GITHUB_OUTPUT: resolve(support, 'output') };
        const runFinish = () => spawnSync(process.execPath, [resolve(import.meta.dirname, 'release-automation.mjs'), 'finish'],
            { cwd: root, encoding: 'utf8', env: finishEnv });
        writeFileSync(resolve(support, 'event.json'), JSON.stringify({ workflow_run: { ...ci, head_sha: 'b'.repeat(40) } }));
        assert.notEqual(runFinish().status, 0);
        assert(!JSON.parse(readFileSync(resolve(support, 'state.json'))).calls.some(args => args.includes('PUT')));
        writeFileSync(resolve(support, 'event.json'), JSON.stringify({ workflow_run: { ...ci, head_sha: candidate } }));
        const finished = runFinish();
        assert.equal(finished.status, 0, finished.stderr);
        assert.equal(readFileSync(resolve(support, 'output'), 'utf8'), `tag=extension-v${version}\ncommit=${candidate}\n`);
        assert(JSON.parse(readFileSync(resolve(support, 'state.json'))).calls.some(args => args.includes('PUT')));

        write('apps/extension/package.json', readFileSync(resolve(root, 'apps/extension/package.json'), 'utf8').replace('true', 'false'));
        const tampered = commit('Change another package field');
        assert.throws(() => validateVersionChange(root, base, tampered, version), /Unexpected changes/);
        git('reset', '--hard', candidate);
        write('packages/toolbar/src/index.ts', 'export const injected = true;\n');
        assert.throws(() => validateVersionChange(root, base, commit('Unexpected code'), version), /only the three recorded versions/);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
