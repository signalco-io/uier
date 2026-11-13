import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { pushVersion, releaseBranchVersion, validateCi, validatePullRequest, validateVersionChange } from './release-automation.mjs';
import { setVersion, versionPaths } from './release-plan.mjs';

const sha = 'a'.repeat(40), repository = 'signalco-io/uier', version = '0.1.6';
const pr = { user: { login: 'github-actions[bot]' }, head: { repo: { full_name: repository }, ref: `extension-release/v${version}`, sha },
    base: { repo: { full_name: repository }, ref: 'main' }, draft: false, commits: 1, state: 'open', merged: false };
const ci = { path: '.github/workflows/ci.yml', event: 'workflow_dispatch', head_repository: { full_name: repository },
    head_branch: pr.head.ref, head_sha: sha, status: 'completed', conclusion: 'success' };

test('CI explicitly hands successful release candidates to main with the current run ID', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'uier-release-handoff-'));
    try {
        const workflow = readFileSync(resolve(import.meta.dirname, '../../../.github/workflows/ci.yml'), 'utf8');
        const script = workflow.split('      - name: Dispatch finalization from main after CI OK\n')[1]
            .split('        run: |\n')[1].trimEnd().split('\n').map(line => line.slice(10)).join('\n');
        writeFileSync(resolve(root, 'gh'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$FIXTURE_ARGS"\n', { mode: 0o700 });
        const env = { ...process.env, PATH: `${root}:${process.env.PATH}`, FIXTURE_ARGS: resolve(root, 'args'),
            GH_TOKEN: 'fixture', GITHUB_REPOSITORY: repository, RELEASE_BRANCH: pr.head.ref, GITHUB_RUN_ID: '123' };
        const run = () => spawnSync('bash', ['--noprofile', '--norc', '-c', script], { encoding: 'utf8', env });
        const result = run();
        assert.equal(result.status, 0, result.stderr);
        assert.equal(readFileSync(resolve(root, 'args'), 'utf8'),
            `workflow\nrun\nextension-release-finish.yml\n--repo\n${repository}\n--ref\nmain\n-f\nversion=${version}\n-f\nci_run_id=123\n`);
        rmSync(resolve(root, 'args'));
        env.RELEASE_BRANCH = 'extension-release/v1.2.3;false';
        assert.notEqual(run().status, 0);
        assert.throws(() => readFileSync(resolve(root, 'args')));
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a version candidate can be refreshed onto new main only with its exact previous head lease', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'uier-release-refresh-'));
    const remote = mkdtempSync(resolve(tmpdir(), 'uier-release-remote-'));
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const write = (path, text) => { mkdirSync(resolve(root, path, '..'), { recursive: true }); writeFileSync(resolve(root, path), text); };
    const environment = Object.fromEntries(['PATH', 'RUNNER_TEMP', 'RELEASE_SSH_KEY', 'FIXTURE_RELEASE_REMOTE'].map(name => [name, process.env[name]]));
    try {
        git('init', '-b', 'main'); git('config', 'user.name', 'Release fixture'); git('config', 'user.email', 'release@example.test');
        git('init', '--bare', remote); git('remote', 'add', 'origin', remote);
        for (const app of ['extension', 'extension-firefox']) write(`apps/${app}/package.json`, '{\n  "version": "0.1.5"\n}\n');
        write('apps/web/src/lib/extension/release.ts', "export const latestExtensionVersion = '0.1.5';\n");
        git('add', '.'); git('commit', '-m', 'Initial');
        const original = git('rev-parse', 'HEAD');
        pushVersion(root, pr.head.ref, version);
        const oldHead = git('rev-parse', 'HEAD');
        // Exercise the deploy-key SSH path against a disposable local bare repository, including
        // key cleanup and lease rejection. No GitHub credentials or network access are involved.
        const transport = resolve(root, '.git/transport');
        mkdirSync(resolve(transport, 'bin'), { recursive: true });
        writeFileSync(resolve(transport, 'bin/gh'), '#!/bin/sh\nprintf "github.com ssh-ed25519 fixture\\n"\n', { mode: 0o700 });
        writeFileSync(resolve(transport, 'bin/ssh'), '#!/bin/sh\nexec git receive-pack "$FIXTURE_RELEASE_REMOTE"\n', { mode: 0o700 });
        Object.assign(process.env, { PATH: `${transport}/bin:${process.env.PATH}`, RUNNER_TEMP: transport,
            RELEASE_SSH_KEY: 'fixture private key', FIXTURE_RELEASE_REMOTE: remote });
        git('switch', 'main'); git('branch', '-D', pr.head.ref);
        write('toolbar-change.txt', 'New main source\n'); git('add', '.'); git('commit', '-m', 'New main source');
        const main = git('rev-parse', 'HEAD');
        pushVersion(root, pr.head.ref, version, oldHead, { trusted: true });
        assert.equal(git('rev-parse', 'HEAD^'), main);
        validateVersionChange(root, main, git('rev-parse', 'HEAD'), version);
        let refreshed = git('rev-parse', 'HEAD');
        pushVersion(root, pr.head.ref, version, refreshed, { base: main, trusted: true });
        assert.notEqual(git('rev-parse', 'HEAD'), refreshed, 'A same-base retry must emit a new trusted synchronization event');
        refreshed = git('rev-parse', 'HEAD');
        assert.equal(git('rev-list', '--count', `${main}..HEAD`), '1');
        assert.deepEqual(readdirSync(transport), ['bin'], 'Temporary key material must be removed');
        git('switch', 'main'); git('branch', '-D', pr.head.ref);
        write('toolbar-change.txt', 'Another main change\n'); git('add', '.'); git('commit', '-m', 'Another main change');
        assert.throws(() => pushVersion(root, pr.head.ref, version, original, { trusted: true }), /Command failed/);
        assert.equal(git('ls-remote', 'origin', `refs/heads/${pr.head.ref}`).split(/\s/)[0], refreshed);
        assert.deepEqual(readdirSync(transport), ['bin']);
    } finally {
        for (const [name, value] of Object.entries(environment)) {
            if (value === undefined) delete process.env[name]; else process.env[name] = value;
        }
        rmSync(root, { recursive: true, force: true }); rmSync(remote, { recursive: true, force: true });
    }
});

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
        { event: 'push' }, { head_repository: { full_name: 'fork/uier' } }, { conclusion: 'failure' }, { status: 'in_progress' }])
        assert.throws(() => validateCi({ ...ci, ...change }, expected));
    validateCi({ ...ci, status: 'in_progress', conclusion: null }, { ...expected, handoff: true });
    validateCi({ ...ci, event: 'pull_request' }, expected);
    assert.throws(() => validateCi({ ...ci, conclusion: 'failure' }, { ...expected, handoff: true }));
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
            html_url: 'https://github.com/signalco-io/uier/pull/7' }, ci: { ...ci, head_sha: candidate }, calls: [] };
        writeFileSync(resolve(support, 'state.json'), JSON.stringify(state));
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
    else if (path === 'actions/runs/123') result = state.ci;
    else if (path.startsWith('actions/workflows/ci.yml/runs?')) result = { workflow_runs: [{ ...state.ci, event: 'pull_request', conclusion: 'action_required' }, state.ci] };
    else if (path.startsWith('commits/')) result = { check_runs: [{ name: 'CI OK', app: { id: 15368 }, head_sha: state.pr.head.sha, conclusion: 'success' }] };
    else throw Error('Unexpected API read: ' + path);
}
fs.writeFileSync(file, JSON.stringify(state));
process.stdout.write(JSON.stringify(result));
`, { mode: 0o700 });
        const finishEnv = { ...process.env, PATH: `${support}/bin:${process.env.PATH}`, FIXTURE_STATE: resolve(support, 'state.json'),
            GITHUB_REPOSITORY: repository, GITHUB_REF: 'refs/heads/main', GITHUB_STEP_SUMMARY: '',
            RELEASE_VERSION: version, CI_RUN_ID: '123', GITHUB_OUTPUT: resolve(support, 'output') };
        const runFinish = () => spawnSync(process.execPath, [resolve(import.meta.dirname, 'release-automation.mjs'), 'finish'],
            { cwd: root, encoding: 'utf8', env: finishEnv });
        writeFileSync(resolve(support, 'state.json'), JSON.stringify({ ...state, ci: { ...state.ci, head_sha: 'b'.repeat(40) } }));
        assert.notEqual(runFinish().status, 0);
        assert(!JSON.parse(readFileSync(resolve(support, 'state.json'))).calls.some(args => args.includes('PUT')));
        writeFileSync(resolve(support, 'state.json'), JSON.stringify({ ...state, ci: { ...state.ci, status: 'in_progress', conclusion: null } }));
        const finished = runFinish();
        assert.equal(finished.status, 0, finished.stderr);
        assert.equal(readFileSync(resolve(support, 'output'), 'utf8'), `tag=extension-v${version}\ncommit=${candidate}\n`);
        assert(JSON.parse(readFileSync(resolve(support, 'state.json'))).calls.some(args => args.includes('PUT')));
        // Recovery ignores the newer approval-required PR run and reuses successful dispatched CI.
        const completedState = JSON.parse(readFileSync(resolve(support, 'state.json')));
        writeFileSync(resolve(support, 'state.json'), JSON.stringify({ ...completedState, ci: state.ci }));
        finishEnv.CI_RUN_ID = '';
        const recovered = runFinish();
        assert.equal(recovered.status, 0, recovered.stderr);

        write('apps/extension/package.json', readFileSync(resolve(root, 'apps/extension/package.json'), 'utf8').replace('true', 'false'));
        const tampered = commit('Change another package field');
        assert.throws(() => validateVersionChange(root, base, tampered, version), /Unexpected changes/);
        git('reset', '--hard', candidate);
        write('packages/toolbar/src/index.ts', 'export const injected = true;\n');
        assert.throws(() => validateVersionChange(root, base, commit('Unexpected code'), version), /only the three recorded versions/);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
