import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { releaseVersion, releaseGate, readArtifact, releaseJournal, digest } from '@uier/extension-core/release';
import { AmoClient, submitFirefox } from './amo.mjs';

releaseGate('firefox');
const root = resolve(import.meta.dirname, '..'), version = releaseVersion(process.env.RELEASE_TAG);
// A reviewed publisher fix on main can resume an older immutable package without rebuilding it.
const commit = process.env.RELEASE_COMMIT;
assert.match(commit ?? '', /^[a-f0-9]{40}$/);
assert.equal(execFileSync('git', ['rev-parse', `refs/tags/${process.env.RELEASE_TAG}^{commit}`], { encoding: 'utf8' }).trim(), commit);
execFileSync('git', ['merge-base', '--is-ancestor', commit, 'origin/main']);
const artifact = await readArtifact({ root, browser: 'firefox', version, commit });
const name = `uier-extension-source-${version}.zip`, bytes = await readFile(resolve(artifact.directory, name));
const source = JSON.parse(await readFile(resolve(artifact.directory, `${name}.json`), 'utf8'));
assert.equal(source.commit, commit); assert.equal(source.sha256, digest(bytes));
const committed = path => execFileSync('git', ['show', `${commit}:${path}`], { encoding: 'utf8' });
const metadata = JSON.parse(committed('apps/extension-firefox/amo-metadata.json'));
metadata.version.custom_license = { name: { 'en-US': 'GNU Affero General Public License, version 3' }, text: { 'en-US': committed('LICENSE') } };
const journal = await releaseJournal({ directory: artifact.directory, tag: process.env.RELEASE_TAG, browser: 'firefox', artifact,
    extraFiles: [name, `${name}.json`, `${name}.sha256`] });
const client = new AmoClient({ issuer: process.env.AMO_API_KEY, secret: process.env.AMO_API_SECRET });
const result = await submitFirefox({ client, artifact, source: { ...source, name, bytes }, metadata, ...journal });
console.log(`Firefox ${version}: ${result.phase}. Mozilla review and signing may still be pending.`);
