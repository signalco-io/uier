import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { StoreClient, revisions } from './store-api.mjs';

/** Bootstrap read: no release tag, journal, GitHub token, upload or publish operation. */
export async function inspectStore(client) {
    const status = await client.status();
    assert(!status.warned && !status.takenDown, 'Inspect the publisher dashboard policy warning or takedown');
    return {
        name: client.name,
        checkedAt: new Date().toISOString(),
        lastAsyncUploadState: status.lastAsyncUploadState ?? 'NOT_FOUND',
        revisions: revisions(status).map(({ kind, version, state }) => ({ kind, version, state }))
    };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    assert.equal(process.env.GITHUB_REPOSITORY, 'signalco-io/uier');
    const client = new StoreClient({ publisherId: process.env.CWS_PUBLISHER_ID, extensionId: process.env.CWS_EXTENSION_ID, token: process.env.CWS_ACCESS_TOKEN });
    const result = await inspectStore(client);
    const summary = `Chrome Web Store bootstrap read succeeded. No store write or release journal update occurred.\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`;
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}
