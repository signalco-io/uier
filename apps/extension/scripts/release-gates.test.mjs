import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

test('publisher authentication is gated by owner acceptance, identifiers and a protected ref', () => {
    const configured = { RELEASE_REF_PROTECTED: 'true', CWS_PUBLISHING_ENABLED: 'true',
        EXTENSION_HOSTED_ACCEPTANCE_URL: 'https://github.com/signalco-io/uier/issues/268#issuecomment-123',
        GCP_PROJECT_ID: 'test-project', GCP_WORKLOAD_IDENTITY_PROVIDER: 'test-provider', GCP_SERVICE_ACCOUNT: 'test-service-account',
        CWS_PUBLISHER_ID: 'test-publisher', CWS_EXTENSION_ID: 'a'.repeat(32) };
    const run = overrides => spawnSync(process.execPath, [resolve(import.meta.dirname, 'release-gates.mjs')], { encoding: 'utf8', env: { ...process.env, ...configured, ...overrides } });
    assert.equal(run({}).status, 0);
    for (const overrides of [{ RELEASE_REF_PROTECTED: 'false' }, { CWS_PUBLISHING_ENABLED: '' },
        { EXTENSION_HOSTED_ACCEPTANCE_URL: 'https://example.test/unchecked' }, { CWS_EXTENSION_ID: 'unregistered' },
        { GCP_WORKLOAD_IDENTITY_PROVIDER: '' }]) assert.notEqual(run(overrides).status, 0);
});
