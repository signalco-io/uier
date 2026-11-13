import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../..', import.meta.url));
function tasks(env = {}) {
    const result = execFileSync(resolve(root, 'node_modules/.bin/turbo'), ['run', 'build', '--filter=@uier/web', '--dry=json'], {
        cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GITHUB_SHA: '', UIER_TOOLBAR_RETAIN_FROM: '', UIER_INSTANT_TEST: '',
            UIER_DEPLOYMENT_ENV: '', VERCEL: '', VERCEL_ENV: '', ...env }
    });
    return new Map(JSON.parse(result).tasks.map(task => [task.taskId, task]));
}
const baseline = tasks();
const toolbar = '@uier/toolbar#build';
const compile = '@uier/web#build:compile';
const finalize = '@uier/web#build';

test('deployment revision and archive changes reuse compilation and still finalize the build', () => {
    const changed = tasks({ GITHUB_SHA: 'a'.repeat(40), UIER_TOOLBAR_RETAIN_FROM: 'https://uier.io' });
    for (const task of [toolbar, compile]) assert.equal(changed.get(task).hash, baseline.get(task).hash, task);
    assert.notEqual(changed.get(finalize).hash, baseline.get(finalize).hash);
    assert.equal(changed.get(finalize).resolvedTaskDefinition.cache, false);
    assert.deepEqual(changed.get(finalize).dependencies, [compile]);
});

test('instant navigation and deployment environments invalidate only the web compilation', () => {
    for (const env of [{ UIER_INSTANT_TEST: '1' }, { UIER_DEPLOYMENT_ENV: 'preview' }, { UIER_DEPLOYMENT_ENV: 'production' }]) {
        const changed = tasks(env);
        assert.equal(changed.get(toolbar).hash, baseline.get(toolbar).hash);
        assert.notEqual(changed.get(compile).hash, baseline.get(compile).hash);
    }
});

test('compilation tracks runtime skills while excluding tests, documentation and deployment preparation', () => {
    const inputs = Object.keys(baseline.get(compile).inputs);
    assert.ok(inputs.includes('next.config.ts'));
    assert.ok(inputs.includes('../../plugins/uier/skills/uier-monitor/SKILL.md'));
    assert.ok(inputs.some(path => path.startsWith('app/')));
    assert.ok(!inputs.some(path => path.startsWith('e2e/') || path.startsWith('docs/')));
    assert.ok(!inputs.includes('scripts/copy-toolbar.mjs'));
    assert.ok(!inputs.includes('scripts/toolbar-assets.mjs'));
    assert.ok(!inputs.includes('../../.github/scripts/search-index.mjs'));
});
