import assert from 'node:assert/strict';
import { AmoClient } from './amo.mjs';
assert.equal(process.env.GITHUB_REPOSITORY, 'signalco-io/uier');
assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
const client = new AmoClient({ issuer: process.env.AMO_API_KEY, secret: process.env.AMO_API_SECRET });
const result = await client.call('addons/upload/?page_size=1');
assert(Array.isArray(result.results), 'Unexpected Mozilla upload-list response');
console.log('Mozilla publisher API authentication succeeded. No store write was performed.');
