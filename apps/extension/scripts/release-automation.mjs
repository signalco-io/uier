import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nextVersion, plan, pullRequestBody, setVersion, versionedText, versionPaths } from './release-plan.mjs';
import { validateTag } from './store-api.mjs';

const repository = 'signalco-io/uier';
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const api = path => JSON.parse(gh('api', `repos/${repository}/${path}`));
const report = message => {
    console.log(message);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
};
const output = values => {
    if (process.env.GITHUB_OUTPUT) for (const [name, value] of Object.entries(values))
        appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
};

export function releaseBranchVersion(branch) {
    assert.match(branch ?? '', /^extension-release\/v\d+\.\d+\.\d+$/);
    return validateTag(branch.replace('extension-release/', 'extension-'));
}

export function validatePullRequest(pr, version) {
    assert.equal(pr.user.login, 'github-actions[bot]', 'Only the daily bot version PR can be merged automatically');
    assert.equal(pr.head.repo.full_name, repository);
    assert.equal(pr.base.repo.full_name, repository);
    assert.equal(pr.base.ref, 'main');
    assert.equal(pr.head.ref, `extension-release/v${version}`);
    assert.equal(pr.draft, false);
    assert.equal(pr.commits, 1, 'The release branch must contain only its version commit');
    assert.match(pr.head.sha, /^[a-f0-9]{40}$/);
    assert(pr.state === 'open' || pr.merged, 'A closed, unmerged release PR requires attention');
}

/** Inspect committed text, never execute code or install dependencies from a candidate branch. */
export function validateVersionChange(root, base, head, version) {
    validateTag(`extension-v${version}`);
    const show = (ref, path) => execFileSync('git', ['show', `${ref}:${path}`], { cwd: root, encoding: 'utf8' });
    const paths = git(root, 'diff', '--name-only', base, head).split('\n').filter(Boolean).sort();
    assert.deepEqual(paths, [...versionPaths].sort(), 'A release PR may change only the three recorded versions');
    assert.equal(git(root, 'diff', '--summary', base, head), '', 'Release edits cannot change file types or modes');
    const before = JSON.parse(show(base, 'apps/extension/package.json')).version;
    assert.equal(nextVersion(before), version, 'The release must advance exactly one version');
    for (const path of versionPaths) {
        const previous = show(base, path);
        assert.equal(previous, versionedText(path, previous, before), 'The previous recorded versions differ');
        assert.equal(show(head, path), versionedText(path, previous, version), `Unexpected changes in ${path}`);
    }
}

export function validateCi(run, { branch, sha, handoff = false }) {
    assert.equal(run.path, '.github/workflows/ci.yml');
    assert.equal(run.event, 'workflow_dispatch');
    assert.equal(run.head_repository.full_name, repository);
    assert.equal(run.head_branch, branch);
    assert.equal(run.head_sha, sha, 'CI must pass on the exact release PR head');
    // The CI handoff job dispatches us after CI OK and can still be cleaning up. The exact-head
    // CI OK check is independently required below; a completed failed/cancelled run never qualifies.
    if (handoff && run.status === 'in_progress') assert.equal(run.conclusion, null);
    else {
        assert.equal(run.status, 'completed');
        assert.equal(run.conclusion, 'success');
    }
}

function candidate(version) {
    const pulls = api(`pulls?head=signalco-io:extension-release/v${version}&base=main&state=all&per_page=100`);
    assert(pulls.length <= 1, 'Multiple version PRs require attention');
    return pulls[0] && api(`pulls/${pulls[0].number}`);
}

function inspectCandidate(root, pr, version) {
    validatePullRequest(pr, version);
    git(root, 'fetch', 'origin', pr.head.sha);
    validateVersionChange(root, `${pr.head.sha}^`, pr.head.sha, version);
    const files = api(`pulls/${pr.number}/files?per_page=100`);
    assert.deepEqual(files.map(file => file.filename).sort(), [...versionPaths].sort());
}

export function pushVersion(root, branch, version, previousHead) {
    assert.equal(releaseBranchVersion(branch), version);
    if (previousHead) assert.match(previousHead, /^[a-f0-9]{40}$/);
    git(root, 'switch', '--create', branch);
    setVersion(root, version);
    git(root, 'add', ...versionPaths);
    git(root, '-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
        'commit', '--message', `chore(extension): release ${version}`);
    const lease = previousHead ? [`--force-with-lease=refs/heads/${branch}:${previousHead}`] : [];
    git(root, 'push', ...lease, 'origin', `${branch}:refs/heads/${branch}`);
}

function prepare(root) {
    const main = git(root, 'rev-parse', 'HEAD');
    const result = plan(root, { force: process.env.FORCE === 'true' });
    if (result.state === 'current') {
        report(`Toolbar unchanged since ${result.tag}. No version bump or release.`);
        return;
    }
    const { version } = result;
    if (result.state === 'untagged') {
        gh('workflow', 'run', 'extension-release-finish.yml', '--repo', repository, '--ref', 'main', '-f', `version=${version}`);
        report(`Resuming finalization of extension ${version}; no new version was created.`);
        return;
    }
    const branch = `extension-release/v${version}`;
    let pr = candidate(version);
    if (!pr) {
        const existing = git(root, 'ls-remote', '--heads', 'origin', branch);
        if (existing) {
            git(root, 'fetch', 'origin', branch);
            const head = git(root, 'rev-parse', 'FETCH_HEAD');
            validateVersionChange(root, `${head}^`, head, version);
        } else {
            pushVersion(root, branch, version);
        }
        const body = resolve(process.env.RUNNER_TEMP, 'extension-release-body.md');
        writeFileSync(body, pullRequestBody(result));
        gh('pr', 'create', '--repo', repository, '--base', 'main', '--head', branch,
            '--title', `chore(extension): release ${version}`, '--body-file', body);
        pr = candidate(version);
    }
    inspectCandidate(root, pr, version);
    assert.equal(pr.state, 'open', 'An already merged release PR must be finalized before preparing another');
    if (git(root, 'rev-parse', `${pr.head.sha}^`) !== main) {
        // The candidate was verified as one version-only commit. Refresh it onto current main,
        // preserving its PR and refusing to overwrite any concurrent branch update.
        pushVersion(root, branch, version, pr.head.sha);
        const head = git(root, 'rev-parse', 'HEAD');
        pr = candidate(version);
        assert.equal(pr.head.sha, head, 'Release branch changed while it was being refreshed');
        inspectCandidate(root, pr, version);
        report(`Refreshed ${pr.html_url} onto current main before dispatching CI.`);
    }
    // Explicit dispatch avoids GitHub's approval requirement for bot-created pull-request workflows.
    gh('workflow', 'run', 'ci.yml', '--repo', repository, '--ref', branch);
    report(`Prepared ${pr.html_url} and dispatched CI. Successful CI will merge, tag and submit extension ${version}.`);
}

function finish(root) {
    const version = process.env.RELEASE_VERSION;
    validateTag(`extension-v${version}`);
    const pr = candidate(version);
    assert(pr, 'No daily release PR exists for this version');
    inspectCandidate(root, pr, version);
    const runId = process.env.CI_RUN_ID;
    if (runId) assert.match(runId, /^[1-9][0-9]*$/, 'Invalid CI run ID');
    const ci = runId ? api(`actions/runs/${runId}`)
        : api(`actions/workflows/ci.yml/runs?branch=${pr.head.ref}&per_page=100`).workflow_runs
            .find(item => item.head_sha === pr.head.sha && item.event === 'workflow_dispatch');
    assert(ci, 'No CI run exists for the release PR');
    validateCi(ci, { branch: pr.head.ref, sha: pr.head.sha, handoff: Boolean(runId) });
    const checks = api(`commits/${pr.head.sha}/check-runs?check_name=CI%20OK&per_page=100`).check_runs;
    const check = checks.find(item => item.app.id === 15368 && item.head_sha === pr.head.sha && item.name === 'CI OK');
    assert.equal(check?.conclusion, 'success', 'The required CI OK check must pass');
    if (!pr.merged) {
        const merged = JSON.parse(gh('api', '--method', 'PUT', `repos/${repository}/pulls/${pr.number}/merge`,
            '-f', `sha=${pr.head.sha}`, '-f', 'merge_method=squash'));
        assert.equal(merged.merged, true, 'GitHub did not merge the version PR');
    }
    const merged = api(`pulls/${pr.number}`);
    assert.equal(merged.merged, true);
    assert.match(merged.merge_commit_sha, /^[a-f0-9]{40}$/);
    git(root, 'fetch', 'origin', 'main');
    git(root, 'merge-base', '--is-ancestor', merged.merge_commit_sha, 'origin/main');
    validateVersionChange(root, `${merged.merge_commit_sha}^`, merged.merge_commit_sha, version);
    output({ tag: `extension-v${version}`, commit: merged.merge_commit_sha });
    report(`Verified and merged ${pr.html_url}. Release source: ${merged.merge_commit_sha}.`);
}

if (import.meta.main) {
    assert.equal(process.env.GITHUB_REPOSITORY, repository);
    assert.equal(process.env.GITHUB_REF, 'refs/heads/main', 'Automation runs only from main');
    const root = git(process.cwd(), 'rev-parse', '--show-toplevel');
    const command = process.argv[2];
    if (command === 'prepare') prepare(root);
    else if (command === 'finish') finish(root);
    else throw new Error('Use: release-automation.mjs prepare | finish');
}
