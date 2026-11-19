import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkerMessage } from '@uier/extension-core/protocol';

test('broker envelopes reject unknown operations, credentials, headers and malformed payloads', () => {
    for (const value of [null, [], 'state', { type: 'fetch', url: 'https://example.test' },
        { type: 'request', url: 'https://uier.io', headers: { Authorization: 'secret' } },
        { type: 'request', url: 'https://uier.io', method: 'PUT' },
        { type: 'start', tabId: -1, projectId: 'a', publicId: 'b' },
        // A new project names the address its form showed, an exact origin, for the worker to compare with the tab:
        // never a page URL, a path or another scheme, and no attempt, token or project of the sender's choosing.
        { type: 'create-project', tabId: 2, name: 'Site', workspaceId: 'w_1' },
        { type: 'create-project', tabId: 2, origin: 'https://example.test/private', name: 'Site', workspaceId: 'w_1' },
        { type: 'create-project', tabId: 2, origin: 'https://example.test/', name: 'Site', workspaceId: 'w_1' },
        { type: 'create-project', tabId: 2, origin: 'https://user@example.test', name: 'Site', workspaceId: 'w_1' },
        { type: 'create-project', tabId: 2, origin: 'file:///etc/hosts', name: 'Site', workspaceId: 'w_1' },
        { type: 'create-project', tabId: 2, origin: 'example.test', name: 'Site', workspaceId: 'w_1' },
        { type: 'create-project', tabId: 2, origin: 'https://example.test', name: 'Site', workspaceId: 'w_1', url: 'https://example.test/private' },
        { type: 'create-project', tabId: 2, origin: 'https://example.test', name: 'Site', workspaceId: 'w_1', attempt: 'a'.repeat(43) },
        { type: 'create-project', tabId: -1, origin: 'https://example.test', name: 'Site', workspaceId: 'w_1' },
        { type: 'create-project', tabId: 2, origin: 'https://example.test', name: 'Site' },
        { type: 'create-project', tabId: 2, origin: 'https://example.test', name: 'Site', workspaceId: '' },
        { type: 'create-project', tabId: 2, origin: 'https://example.test', name: 7, workspaceId: 'w_1' },
        { type: 'create-project', tabId: 2, origin: 'https://example.test', name: 'n'.repeat(201), workspaceId: 'w_1' },
        { type: 'create-project', tabId: 2, origin: 'https://example.test', name: 'Site', workspaceId: 'w'.repeat(129) },
        { type: 'draft', key: 'unscoped', value: 'private' },
        { type: 'draft', key: 'uier:draft:v1:a', value: 'data:image/png;base64,AAAA' },
        { type: 'capture', region: { left: 0 } },
        { type: 'helper-job', nonce: 'forged' },
        { type: 'verified', nonce: 'a'.repeat(43), proof: { token: 'proof', expiresAt: NaN } },
        { type: 'sign-out', token: 'secret' }, { type: 'state', tabId: 1 },
        // The worker alone picks the tab the popup's frame describes: no tab, URL or origin from the sender.
        { type: 'tab', tabId: 1 }, { type: 'tab', url: 'https://example.test' }, { type: 'tab', origin: 'https://example.test' },
        { type: 'update', version: '9.9.9' }, { type: 'install-update', url: 'https://example.test/uier.crx' },
        // The worker alone picks the packaged audit file and the bound document: no file, URL, world or tab from content.
        { type: 'audit', file: 'https://example.test/axe.js' }, { type: 'audit', files: ['content.js'] }, { type: 'audit', world: 'MAIN' }, { type: 'audit', tabId: 2 }]) {
        assert.throws(() => parseWorkerMessage(value), 'Unsupported extension message');
    }
    for (const value of [{ type: 'state' }, { type: 'tab' }, { type: 'update' }, { type: 'install-update' }, { type: 'audit' }, { type: 'exit' }, { type: 'exit', tabId: 2 },
        { type: 'start', tabId: 2, projectId: 'a', publicId: 'b' },
        { type: 'create-project', tabId: 2, origin: 'https://example.test', name: 'Site', workspaceId: 'w_1' },
        { type: 'create-project', tabId: 2, origin: 'http://localhost:3000', name: '', workspaceId: 'w_1' },
        { type: 'draft', key: 'uier:draft:v1:scoped', value: null },
        { type: 'request', url: 'https://uier.io/api/review/a/comments', method: 'POST', body: { text: 'feedback' } },
        { type: 'capture', region: { left: 0, top: 0, width: 50, height: 40, viewportWidth: 100, viewportHeight: 100 } }]) {
        assert.equal(parseWorkerMessage(value), value);
    }
});
