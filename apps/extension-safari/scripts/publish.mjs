import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { releaseVersion, releaseGate, extractArtifact, releaseJournal } from '@uier/extension-core/release';
import { nativeArchive, command } from './native.mjs';
import { AppStoreClient, submitSafari } from './app-store.mjs';

releaseGate('safari');
const root = resolve(import.meta.dirname, '..'), version = releaseVersion(process.env.RELEASE_TAG);
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const artifact = await extractArtifact({ root, browser: 'safari', version, commit });
const journal = await releaseJournal({ directory: artifact.directory, tag: process.env.RELEASE_TAG, browser: 'safari', artifact });
const appId = process.env.ASC_APP_ID;
const receipt = journal.receipt ?? { schema: 1, browser: 'safari', version, commit, sha256: artifact.sha256, appId, phase: 'prepared' };
const client = new AppStoreClient({ keyId: process.env.ASC_KEY_ID, issuer: process.env.ASC_ISSUER_ID, privateKey: process.env.ASC_PRIVATE_KEY });
const submitForReview = process.env.SAFARI_SUBMIT_FOR_REVIEW === 'true';
if (submitForReview) assert.equal(process.env.SAFARI_METADATA_READY, 'true', 'Complete App Store listing, screenshots, privacy, review contact and export-compliance metadata first');
const temporary = await mkdtemp(join(tmpdir(), 'uier-asc-upload-'));
try {
    const key = resolve(temporary, `AuthKey_${process.env.ASC_KEY_ID}.p8`);
    await writeFile(key, process.env.ASC_PRIVATE_KEY, { mode: 0o600 });
    // Compile/sign before the durable store-write checkpoint. A compiler failure is safe to retry.
    const built = receipt.phase === 'prepared' ? await nativeArchive({ root, signed: true }) : undefined;
    const result = await submitSafari({ client, appId, version, receipt, checkpoint: journal.checkpoint, submitForReview,
        async upload() {
            assert(built?.package, 'Missing signed Safari installer');
            command('xcrun', ['iTMSTransporter', '-m', 'upload', '-assetFile', built.package,
                '-apiKey', process.env.ASC_KEY_ID, '-apiIssuer', process.env.ASC_ISSUER_ID], {
                stdio: 'inherit', env: { ...process.env, API_PRIVATE_KEYS_DIR: temporary }
            });
        }
    });
    const summary = `Safari ${version}: ${result.phase}. Upload and review are separate from App Store approval.\n`;
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
} finally { await rm(temporary, { recursive: true, force: true }); }
