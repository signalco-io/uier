import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePreviewEnvironment, preservePreviewValue } from '../dist/previewEnvironment.js';

test('preview metadata retains existing optional values without admitting secret values or updates', () => {
    const metadata = [{ name: 'vercel-uier-env-anthropic', key: 'ANTHROPIC_API_KEY', sensitive: true }];
    const encoded = JSON.stringify(metadata);
    const existing = parsePreviewEnvironment(encoded, true);
    assert.deepEqual(preservePreviewValue(existing, 'ANTHROPIC_API_KEY', metadata[0].name), { ignoreChanges: ['value'] });
    assert.deepEqual(preservePreviewValue(existing, 'NOTION_CLIENT_SECRET', 'vercel-uier-env-integration-notion-client-secret'), {});
    assert.throws(() => parsePreviewEnvironment(encoded, false), /cannot be used for an update/);
    assert.throws(() => preservePreviewValue(existing, 'ANTHROPIC_API_KEY', 'renamed-resource'), /does not match state/);
});

test('malformed, duplicate and value-bearing preview metadata fail without echoing submitted data', () => {
    const marker = 'private-fixture-material';
    const item = { name: 'vercel-uier-env-anthropic', key: 'ANTHROPIC_API_KEY', sensitive: true };
    for (const encoded of [marker, '{}', JSON.stringify([item, item]), JSON.stringify([{ ...item, value: marker }]),
        JSON.stringify([{ ...item, key: marker }]), JSON.stringify([{ ...item, sensitive: marker }])]) {
        assert.throws(() => parsePreviewEnvironment(encoded, true), error => !String(error).includes(marker));
    }
});
