import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { StoreClient, submitRelease, targetState, validateTag } from './store-api.mjs';

const command = process.argv[2];
assert(['submit', 'status', 'select-status'].includes(command), 'Use submit, status or select-status');
const repo = process.env.GITHUB_REPOSITORY;
assert.equal(repo, 'signalco-io/uier', 'Publishing is restricted to this repository');
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
let tag = process.env.RELEASE_TAG;
if (command === 'select-status') {
    if (!tag) {
        const releases = JSON.parse(gh('api', `repos/${repo}/releases?per_page=20`));
        tag = releases.find(release => release.draft && /^extension-v\d+\.\d+\.\d+$/.test(release.tag_name))?.tag_name;
    }
    if (tag) validateTag(tag);
    if (process.env.GITHUB_OUTPUT) await import('node:fs/promises').then(fs => fs.appendFile(process.env.GITHUB_OUTPUT, `tag=${tag ?? ''}\n`));
    process.exit(0);
}
const version = validateTag(tag);
const out = resolve(import.meta.dirname, '../release');
await mkdir(out, { recursive: true });
const client = new StoreClient({ publisherId: process.env.CWS_PUBLISHER_ID, extensionId: process.env.CWS_EXTENSION_ID, token: process.env.CWS_ACCESS_TOKEN });
let artifact;
const zipName = `uier-extension-${version}.zip`;
if (command === 'submit') {
    assert.equal(process.env.CWS_PUBLISHING_ENABLED, 'true', 'Publishing is not enabled in extension-production');
    assert.match(process.env.EXTENSION_HOSTED_ACCEPTANCE_URL ?? '', /^https:\/\/github\.com\/signalco-io\/uier\/(?:issues|actions\/runs)\/[0-9]+(?:[?#].*)?$/, 'Record real hosted Chrome/Edge acceptance before enabling publication');
    const metadata = JSON.parse(await readFile(resolve(out, `${zipName}.json`), 'utf8'));
    const bytes = await readFile(resolve(out, zipName));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    assert.equal(metadata.version, version); assert.equal(metadata.sha256, sha256); assert.equal(metadata.dirty, false, 'Release worktree must be clean');
    assert.equal(metadata.commit, execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
    artifact = { ...metadata, bytes, hostedAcceptance: process.env.EXTENSION_HOSTED_ACCEPTANCE_URL };
}
const receiptName = `uier-extension-${version}.store.json`;
const receiptPath = resolve(out, receiptName);
let release;
try { release = JSON.parse(gh('release', 'view', tag, '--repo', repo, '--json', 'tagName,targetCommitish,isDraft,assets')); }
catch {
    // Distinguish an absent release from unavailable permissions/network; never recreate blindly.
    const releases = JSON.parse(gh('api', `repos/${repo}/releases?per_page=100`));
    assert(!releases.some(r => r.tag_name === tag), 'Existing release could not be read');
    if (command === 'status') throw new Error('No release journal exists for this tag');
    gh('release', 'create', tag, '--repo', repo, '--verify-tag', '--draft', '--title', `uier extension ${version}`, '--notes', 'Extension release journal. Store state is recorded in the receipt; this draft is not a publication announcement.');
    release = JSON.parse(gh('release', 'view', tag, '--repo', repo, '--json', 'isDraft,assets'));
}
assert.equal(release.isDraft, true, 'Release journals must stay draft; reconcile a public release before modifying it');
let receipt;
if (release.assets.some(asset => asset.name === receiptName)) {
    gh('release', 'download', tag, '--repo', repo, '--pattern', receiptName, '--dir', out, '--clobber');
    receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
}
const checkpoint = async value => {
    await writeFile(receiptPath, JSON.stringify(value, null, 2) + '\n');
    gh('release', 'upload', tag, receiptPath, '--repo', repo, '--clobber');
};
let result;
try {
    if (command === 'status') {
        assert(receipt && receipt.schema === 1 && receipt.version === version && receipt.name === client.name, 'Missing or mismatched receipt');
        const phase = targetState(await client.status(), version);
        if (phase !== 'not-submitted' && phase !== 'unknown') { result = { ...receipt, phase, updatedAt: new Date().toISOString() }; await checkpoint(result); }
        else throw new Error('The target version is not visible in store status; reconcile the retained receipt in the dashboard');
        assert(!['rejected', 'cancelled'].includes(phase), `Store submission is ${phase}`);
    } else {
        const { sha256 } = artifact;
        const existing = release.assets.find(asset => asset.name === `${zipName}.sha256`);
        if (existing) {
            assert([zipName, `${zipName}.json`].every(name => release.assets.some(asset => asset.name === name)), 'Incomplete retained package requires release reconciliation');
            const saved = gh('release', 'download', tag, '--repo', repo, '--pattern', `${zipName}.sha256`, '--output', '-').trim();
            assert.equal(saved.split(/\s/)[0], sha256, 'Tag already has a different package checksum');
        } else {
            assert(!release.assets.some(asset => [zipName, `${zipName}.json`].includes(asset.name)), 'Partial artifact upload requires dashboard/release reconciliation');
            // No --clobber: an existing artifact is immutable. Only the bounded store journal updates.
            gh('release', 'upload', tag, ...[zipName, `${zipName}.sha256`, `${zipName}.json`].map(name => resolve(out, name)), '--repo', repo);
        }
        result = await submitRelease({ client, artifact, receipt, checkpoint });
    }
    const summary = `uier extension ${version}: **${result.phase}**. Source: ${result.commit}. SHA-256: ${result.sha256}.\n`;
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) await import('node:fs/promises').then(fs => fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary));
} catch (error) {
    // The pre-write receipt is retained even when a request or a later checkpoint is uncertain.
    if (process.env.GITHUB_STEP_SUMMARY) await import('node:fs/promises').then(fs => fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `Extension ${version}: failed or requires reconciliation. Inspect the retained release receipt and Chrome Web Store dashboard.\n`));
    throw error;
}
