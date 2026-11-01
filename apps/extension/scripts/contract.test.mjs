import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extensionOperation, allowedExtensionOperation } from '../../../packages/toolbar/dist/extensionContract.js';
test('broker v1 permits review operations and refuses open fetches and credential routes', () => {
    assert.deepEqual(extensionOperation('https://uier.io/api/review/code/comments?path=%2Faccount', 'https://uier.io', 'code', 'POST'), { path: 'comments', query: '?path=%2Faccount' });
    for (const url of ['https://evil.test/api/review/code/comments', 'https://uier.io/api/review/other/comments', 'https://uier.io/api/review/code/session', 'https://uier.io/api/review/code/comments?url=https://evil.test', 'https://uier.io/api/review/code/comments/%2e%2e/session']) {
        assert.throws(() => extensionOperation(url, 'https://uier.io', 'code', 'POST'));
    }
    assert(!allowedExtensionOperation('comments', 'PUT'));
    assert(!allowedExtensionOperation('comments/id/screenshot', 'DELETE'));
    assert(allowedExtensionOperation('comments/comment_id/replies/item_id', 'DELETE'));
});
