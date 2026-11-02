import assert from 'node:assert/strict';
assert.equal(process.env.RELEASE_REF_PROTECTED, 'true', 'Publishing requires a protected release ref');
assert.equal(process.env.CWS_PUBLISHING_ENABLED, 'true', 'Owner must enable CWS_PUBLISHING_ENABLED after bootstrap and hosted acceptance');
assert.match(process.env.EXTENSION_HOSTED_ACCEPTANCE_URL ?? '', /^https:\/\/github\.com\/signalco-io\/uier\/(?:issues|actions\/runs)\/[0-9]+(?:[?#].*)?$/, 'Record real hosted Chrome and Edge evidence');
for (const name of ['GCP_PROJECT_ID', 'GCP_WORKLOAD_IDENTITY_PROVIDER', 'GCP_SERVICE_ACCOUNT', 'CWS_PUBLISHER_ID', 'CWS_EXTENSION_ID'])
    assert(process.env[name]?.trim(), `Missing extension-production variable: ${name}`);
assert.match(process.env.CWS_EXTENSION_ID, /^[a-p]{32}$/);
console.log('Owner-configured hosted/store gates are present. Store API validation is still required during bootstrap.');
