import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkerMessage } from '@uier/extension-core/protocol';

test('broker envelopes reject unknown operations, credentials, headers and malformed payloads', () => {
    for (const value of [null, [], 'state', { type: 'fetch', url: 'https://example.test' },
        { type: 'request', url: 'https://uier.io', headers: { Authorization: 'secret' } },
        { type: 'request', url: 'https://uier.io', method: 'PUT' },
        { type: 'start', tabId: -1, projectId: 'a', publicId: 'b' },
        { type: 'draft', key: 'unscoped', value: 'private' },
        { type: 'draft', key: 'uier:draft:v1:a', value: 'data:image/png;base64,AAAA' },
        { type: 'capture', region: { left: 0 } },
        { type: 'helper-job', nonce: 'forged' },
        { type: 'verified', nonce: 'a'.repeat(43), proof: { token: 'proof', expiresAt: NaN } },
        { type: 'sign-out', token: 'secret' }, { type: 'state', tabId: 1 },
        { type: 'update', version: '9.9.9' }, { type: 'install-update', url: 'https://example.test/uier.crx' }]) {
        assert.throws(() => parseWorkerMessage(value), 'Unsupported extension message');
    }
    for (const value of [{ type: 'state' }, { type: 'update' }, { type: 'install-update' }, { type: 'exit' }, { type: 'exit', tabId: 2 },
        { type: 'start', tabId: 2, projectId: 'a', publicId: 'b' },
        { type: 'draft', key: 'uier:draft:v1:scoped', value: null },
        { type: 'request', url: 'https://uier.io/api/review/a/comments', method: 'POST', body: { text: 'feedback' } },
        { type: 'capture', region: { left: 0, top: 0, width: 50, height: 40, viewportWidth: 100, viewportHeight: 100 } }]) {
        assert.equal(parseWorkerMessage(value), value);
    }
});
