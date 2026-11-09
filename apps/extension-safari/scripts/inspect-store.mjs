import assert from 'node:assert/strict';
import { AppStoreClient } from './app-store.mjs';
assert.equal(process.env.GITHUB_REPOSITORY, 'signalco-io/uier');
assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
assert.match(process.env.ASC_APP_ID ?? '', /^\d+$/);
const client = new AppStoreClient({ keyId: process.env.ASC_KEY_ID, issuer: process.env.ASC_ISSUER_ID, privateKey: process.env.ASC_PRIVATE_KEY });
const result = await client.call(`/v1/apps/${process.env.ASC_APP_ID}`);
assert.equal(result.data.attributes.bundleId, 'io.uier.safari');
console.log('App Store Connect authentication and Safari app identity succeeded. No store write was performed.');
