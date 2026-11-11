import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const workflow = readFileSync(new URL('../workflows/deploy-current_reusable.yml', import.meta.url), 'utf8');
const script = workflow.split('        run: |\n')[1].trimEnd().split('\n')
    .map(line => line.slice(10)).join('\n');

function check(latest, { run = '100', apiExit = '0' } = {}) {
    const directory = mkdtempSync(join(tmpdir(), 'uier-deployment-current-'));
    const output = join(directory, 'output');
    const summary = join(directory, 'summary');
    const args = join(directory, 'args');
    try {
        for (const path of [output, summary, args]) writeFileSync(path, '');
        writeFileSync(join(directory, 'gh'), `#!/bin/bash
printf '%s\\n' "$@" > "$FIXTURE_ARGS"
printf '%s\\n' "$FIXTURE_LATEST"
exit "$FIXTURE_EXIT"
`, { mode: 0o700 });
        const result = spawnSync('bash', ['--noprofile', '--norc', '-c', script], {
            encoding: 'utf8',
            env: {
                PATH: `${directory}:${process.env.PATH}`,
                GH_TOKEN: 'fixture',
                GITHUB_REPOSITORY: 'signalco-io/uier',
                GITHUB_RUN_ID: run,
                GITHUB_SERVER_URL: 'https://github.com',
                GITHUB_OUTPUT: output,
                GITHUB_STEP_SUMMARY: summary,
                FIXTURE_ARGS: args,
                FIXTURE_LATEST: latest,
                FIXTURE_EXIT: apiExit,
            },
        });
        return { ...result, output: readFileSync(output, 'utf8'), summary: readFileSync(summary, 'utf8'), args: readFileSync(args, 'utf8') };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

test('the newest eligible run proceeds, including a retry of that run', () => {
    const result = check('42918534667', { run: '42918534667' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, 'current=true\n');
    assert.equal(result.summary, '');
    // Documentation-only pushes have no Deploy run. Do not query HEAD or filter out
    // pending/failed runs: those still represent the newer intended release.
    assert.equal(result.args, 'api\nrepos/signalco-io/uier/actions/workflows/deploy.yml/runs?branch=main&per_page=1\n--jq\n.workflow_runs[0].id\n');
});

test('a newer eligible release supersedes this run, including a retry of an old run', () => {
    const result = check('42918534667', { run: '42918359665' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, 'current=false\n');
    assert.equal(result.summary, 'Superseded by https://github.com/signalco-io/uier/actions/runs/42918534667.\n');
});

test('a run not yet visible in the list is not superseded by an older release', () => {
    const result = check('99');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, 'current=true\n');
});

test('an empty or malformed API result blocks release', () => {
    for (const value of ['', 'null', 'not-a-run', '100\n101']) {
        const result = check(value);
        assert.notEqual(result.status, 0);
        assert.equal(result.output, '');
        assert.match(result.stdout, /::error::/);
    }
});

test('a failed API request never emits permission to release', () => {
    const result = check('100', { apiExit: '1' });
    assert.notEqual(result.status, 0);
    assert.equal(result.output, '');
});
