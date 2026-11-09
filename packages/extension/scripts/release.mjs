import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { validate } from './validate.mjs';

export const repository = 'signalco-io/uier';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function releaseVersion(tag) {
    assert.match(tag ?? '', /^extension-v\d+\.\d+\.\d+$/, 'Use a protected extension-vX.Y.Z tag');
    return tag.slice('extension-v'.length);
}
export function releaseGate(browser, env = process.env) {
    assert(['firefox', 'safari'].includes(browser));
    assert.equal(env.GITHUB_REPOSITORY, repository);
    assert.equal(env.RELEASE_REF_PROTECTED, 'true', 'Release ref must be protected');
    assert.equal(env[`${browser.toUpperCase()}_PUBLISHING_ENABLED`], 'true', 'Owner has not enabled this browser release');
    assert.match(env.HOSTED_ACCEPTANCE_URL ?? '', /^https:\/\/github\.com\/signalco-io\/uier\/(?:issues|actions\/runs)\/[0-9]+(?:[?#].*)?$/, 'Record native hosted browser acceptance first');
}
export async function readArtifact({ root, browser, version, commit, clean = true }) {
    const name = `uier-extension-${browser}-${version}.zip`;
    const directory = resolve(root, 'release');
    const bytes = await readFile(resolve(directory, name));
    const metadata = JSON.parse(await readFile(resolve(directory, `${name}.json`), 'utf8'));
    assert.equal(metadata.version, version); assert.equal(metadata.browser, browser);
    assert.equal(metadata.sha256, digest(bytes)); assert.equal(metadata.contractVersion, 1);
    if (commit) assert.equal(metadata.commit, commit, 'Package source differs from the release checkout');
    if (clean) assert.equal(metadata.dirty, false, 'Release checkout must be clean');
    const files = execFileSync('unzip', ['-Z1', resolve(directory, name)], { encoding: 'utf8' }).trim().split('\n');
    assert(files.every(path => path && !path.startsWith('/') && !path.includes('\\') && !path.split('/').some(p => p === '..' || p === '.')));
    assert.equal(new Set(files).size, files.length, 'Duplicate ZIP entries');
    assert.deepEqual([...files].sort(), metadata.files, 'Package inventory differs from receipt');
    return { ...metadata, bytes, name, directory };
}
export async function extractArtifact(options) {
    const artifact = await readArtifact(options);
    const directory = resolve(options.root, 'dist');
    await rm(directory, { recursive: true, force: true }); await mkdir(directory, { recursive: true });
    execFileSync('unzip', ['-q', resolve(artifact.directory, artifact.name), '-d', directory]);
    assert.deepEqual((await validate(directory, options)).files, artifact.files);
    return artifact;
}
export async function sourceArchive({ directory, version, cwd = process.cwd() }) {
    await mkdir(directory, { recursive: true });
    const name = `uier-extension-source-${version}.zip`, file = resolve(directory, name);
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    // Only committed files, never local credentials, generated resources or ignored dependencies.
    execFileSync('git', ['archive', '--format=zip', `--output=${file}`, 'HEAD'], { cwd });
    const sha256 = digest(await readFile(file));
    await writeFile(`${file}.sha256`, `${sha256}  ${name}\n`);
    await writeFile(`${file}.json`, JSON.stringify({ commit, sha256, version }, null, 2) + '\n');
    return { name, file, sha256, commit, version };
}

// The journal must be persisted outside the runner before each non-idempotent store write.
// Callers serialize browser submissions in the workflow so release creation cannot race Chrome.
export async function releaseJournal({ directory, tag, browser, artifact, extraFiles = [], gh = (...args) => execFileSync('gh', args, { stdio: ['ignore', 'pipe', 'pipe'] }) }) {
    const version = releaseVersion(tag);
    const releases = JSON.parse(gh('api', `repos/${repository}/releases?per_page=100`));
    let release = releases.find(item => item.tag_name === tag);
    if (!release) {
        gh('release', 'create', tag, '--repo', repository, '--verify-tag', '--draft', '--title', `uier extension ${version}`, '--notes', 'Extension release journal. Browser store receipts record submission state.');
        release = JSON.parse(gh('release', 'view', tag, '--repo', repository, '--json', 'isDraft,assets'));
    }
    assert.equal(release.draft ?? release.isDraft, true, 'Store journals must remain draft');
    // Re-read assets after creating the draft; no artifact is ever overwritten.
    const current = JSON.parse(gh('release', 'view', tag, '--repo', repository, '--json', 'assets'));
    for (const file of [artifact.name, `${artifact.name}.json`, `${artifact.name}.sha256`, ...extraFiles]) {
        assert.equal(file, basename(file));
        const path = resolve(directory, file);
        if (current.assets.some(item => item.name === file)) {
            const saved = gh('release', 'download', tag, '--repo', repository, '--pattern', file, '--output', '-');
            assert.equal(digest(Buffer.from(saved, 'binary')), digest(await readFile(path)), `Retained ${file} differs`);
        } else gh('release', 'upload', tag, path, '--repo', repository);
    }
    const name = `uier-extension-${browser}-${version}.store.json`, path = resolve(directory, name);
    let receipt;
    if (current.assets.some(item => item.name === name)) receipt = JSON.parse(gh('release', 'download', tag, '--repo', repository, '--pattern', name, '--output', '-'));
    if (receipt) {
        assert.equal(receipt.browser, browser); assert.equal(receipt.version, version);
        assert.equal(receipt.sha256, artifact.sha256); assert.equal(receipt.commit, artifact.commit);
    }
    const checkpoint = async value => {
        await writeFile(path, JSON.stringify(value, null, 2) + '\n');
        gh('release', 'upload', tag, path, '--repo', repository, '--clobber');
        receipt = value;
    };
    return { receipt, checkpoint };
}
