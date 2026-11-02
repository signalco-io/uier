import assert from 'node:assert/strict';
import test from 'node:test';
import { loadWorkerSettings, parseWorkerSettings } from '../../apps/web/scripts/worker-settings.mjs';

const settings = { COSMOSDB_ENDPOINT: 'https://fixture.documents.azure.com/',
    AZURE_SCREENSHOTS_ENDPOINT: 'https://fixture.blob.core.windows.net/', UIER_COMMENTS_SECRET: 'fixture-secret',
    ACS_CONNECTION_STRING: 'fixture-mail', UIER_EMAIL_SENDER: 'fixture@example.invalid' };

test('the worker accepts only its runtime settings, never deployment/account keys or endpoint overrides', () => {
    assert.deepEqual(parseWorkerSettings(JSON.stringify(settings)), settings);
    for (const name of ['VERCEL_TOKEN', 'CLOUDFLARE_API_TOKEN', 'ANTHROPIC_API_KEY', 'COSMOSDB_CONNECTION_STRING',
        'AZURE_SCREENSHOTS_CONNECTION_STRING', 'AZURE_CLIENT_ID', 'UIER_DEPLOYMENT_ENV', 'GITHUB_ACTIONS',
        'NODE_OPTIONS', 'GOOGLE_CLIENT_SECRET', 'NOTION_API_BASE_URL', '__proto__']) {
        assert.throws(() => parseWorkerSettings(JSON.stringify({ ...settings, [name]: 'private-marker' })),
            error => !String(error).includes('private-marker'));
    }
    for (const encoded of [undefined, '', '[]', '{}', '{', JSON.stringify({ ...settings, UIER_COMMENTS_SECRET: '' }),
        JSON.stringify({ ...settings, UIER_COMMENTS_SECRET: 'x'.repeat(48_001) }),
        JSON.stringify({ ...settings, SLACK_DISTRIBUTION_APPROVED: 'private-marker' })])
        assert.throws(() => parseWorkerSettings(encoded));
});

test('secret values are masked before configuration is loaded; multiline commands cannot escape masking', () => {
    const values = { ...settings, UIER_GITHUB_PRIVATE_KEY: 'first%line\n::warning::fixture-private-line',
        SLACK_DISTRIBUTION_APPROVED: '1' };
    const environment = { GITHUB_ACTIONS: 'true', UIER_WORKER_SETTINGS: JSON.stringify(values) };
    const output = [];
    loadWorkerSettings(environment.UIER_WORKER_SETTINGS, environment, line => {
        assert.equal(environment.UIER_COMMENTS_SECRET, undefined);
        output.push(line);
    });
    // Except the public release gate: masking "1" would hide exit codes and delivery ids in the log
    assert.equal(output.length, Object.keys(values).length - 1);
    assert.ok(!output.includes('::add-mask::1\n'));
    assert.ok(output.includes('::add-mask::first%25line%0A::warning::fixture-private-line\n'));
    assert.equal(environment.UIER_WORKER_SETTINGS, undefined);
    for (const [name, value] of Object.entries(values)) assert.equal(environment[name], value);
});
