import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { validateTag } from './store-api.mjs';
const tag = process.env.RELEASE_TAG;
const version = validateTag(tag);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const commit = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`);
execFileSync('git', ['merge-base', '--is-ancestor', commit, 'origin/main']);
for (const app of ['extension', 'extension-firefox']) {
    const pkg = JSON.parse(git('show', `${commit}:apps/${app}/package.json`));
    assert.equal(pkg.version, version, `${app} version differs from the release tag`);
}
assert.match(commit, /^[a-f0-9]{40}$/);
if (process.env.RELEASE_COMMIT) assert.equal(commit, process.env.RELEASE_COMMIT, 'Release tag moved after validation');
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `commit=${commit}\nversion=${version}\ntag=${tag}\n`);
console.log(`Validated ${tag} at ${commit} on main`);
