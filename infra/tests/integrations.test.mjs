import assert from 'node:assert/strict';
import test from 'node:test';
import { parseIntegrationEnvironment } from '../dist/integrations.js';

const current = Buffer.alloc(32, 1).toString('base64');
const previous = Buffer.alloc(32, 2).toString('base64');
const families = ['NOTION_TOKEN_KEY', 'LINEAR_TOKEN_KEY', 'SLACK_TOKEN_KEY', 'UIER_GITHUB_SETUP_KEY', 'AZURE_DEVOPS_TOKEN_KEY'];
const parse = value => parseIntegrationEnvironment(JSON.stringify(value));

test('an absent map and a supported provider subset preserve exact server-only values', () => {
    assert.deepEqual(parseIntegrationEnvironment(undefined), {});
    assert.deepEqual(parseIntegrationEnvironment(''), {});
    assert.deepEqual(parse({}), {});
    const subset = { NOTION_CLIENT_ID: 'fixture-client', NOTION_CLIENT_SECRET: 'fixture-secret',
        SLACK_APP_ID: 'A123FIXTURE', SLACK_DISTRIBUTION_APPROVED: '0', UIER_GITHUB_PRIVATE_KEY: 'fixture\nmultiline\nkey' };
    assert.deepEqual(parse(subset), subset);
    assert.deepEqual(parse({ SLACK_DISTRIBUTION_APPROVED: '1' }), { SLACK_DISTRIBUTION_APPROVED: '1' });
});

test('endpoint, public-variable and deployment-mode overrides are outside the credential allowlist', () => {
    for (const name of ['NOTION_API_BASE_URL', 'NOTION_OAUTH_AUTHORIZE_URL', 'LINEAR_API_BASE_URL', 'LINEAR_OAUTH_TOKEN_URL',
        'LINEAR_OAUTH_AUTHORIZE_URL', 'LINEAR_OAUTH_REVOKE_URL', 'SLACK_API_BASE_URL', 'SLACK_OAUTH_AUTHORIZE_URL',
        'AZURE_DEVOPS_API_BASE_URL', 'AZURE_DEVOPS_PROFILE_BASE_URL', 'AZURE_DEVOPS_OAUTH_AUTHORIZE_URL', 'AZURE_DEVOPS_OAUTH_TOKEN_URL',
        'UIER_GITHUB_API_BASE_URL', 'UIER_GITHUB_OAUTH_BASE_URL', 'UIER_DEPLOYMENT_ENV', 'UIER_LOCAL', 'NEXT_PUBLIC_NOTION_CLIENT_SECRET'])
        assert.throws(() => parse({ [name]: 'https://fixture.invalid' }), /unsupported variable/);
});

test('maps require non-empty bounded strings and a known Slack release flag', () => {
    for (const value of [null, [], ['fixture'], 1, true, 'fixture']) assert.throws(() => parse(value), /JSON string map/);
    for (const value of [null, 1, true, {}, [], '', '  ', 'fixture\0secret', 'x'.repeat(16_385)])
        assert.throws(() => parse({ NOTION_CLIENT_SECRET: value }), /non-empty bounded strings/);
    for (const value of ['true', 'yes', '01']) assert.throws(() => parse({ SLACK_DISTRIBUTION_APPROVED: value }), /distribution gate/);
});

test('the Azure DevOps tenant is either all work and school accounts or one tenant id', () => {
    for (const value of ['organizations', '72f988bf-86f1-41af-91ab-2d7cd011db47'])
        assert.deepEqual(parse({ AZURE_DEVOPS_TENANT: value }), { AZURE_DEVOPS_TENANT: value });
    for (const value of ['common', 'consumers', 'contoso.onmicrosoft.com', '../organizations'])
        assert.throws(() => parse({ AZURE_DEVOPS_TENANT: value }), /Microsoft Entra tenant/);
});

test('each encryption family requires explicit paired ids, canonical key material and distinct previous ids', () => {
    for (const name of families) {
        const rotation = { [name]: current, [`${name}_ID`]: 'k2', [`${name}_PREVIOUS`]: previous, [`${name}_PREVIOUS_ID`]: 'k1' };
        assert.deepEqual(parse(rotation), rotation);
        assert.deepEqual(parse({ [name]: current, [`${name}_ID`]: 'initial-import' }), { [name]: current, [`${name}_ID`]: 'initial-import' });
        for (const value of [{ [name]: current }, { [`${name}_ID`]: 'k2' }, { [`${name}_PREVIOUS`]: previous },
            { [`${name}_PREVIOUS_ID`]: 'k1' }, { ...rotation, [`${name}_PREVIOUS_ID`]: 'k2' },
            { ...rotation, [`${name}_PREVIOUS`]: current }, { ...rotation, [`${name}_ID`]: 'bad.id' },
            { ...rotation, [`${name}_PREVIOUS_ID`]: 'x'.repeat(33) }, { [name]: current, [`${name}_ID`]: 'k1', [`${name}_PREVIOUS`]: previous, [`${name}_PREVIOUS_ID`]: 'k1' }])
            assert.throws(() => parse(value), /encryption key rotation/);
        for (const key of ['not-base64', Buffer.alloc(31).toString('base64'), Buffer.alloc(33).toString('base64'),
            current + '\n', 'A'.repeat(42) + 'B=']) assert.throws(() => parse({ ...rotation, [name]: key }), /encryption key rotation/);
    }
});

test('invalid input errors never echo names, values or malformed JSON fragments', () => {
    const marker = 'fixture-private-provider-material';
    for (const encoded of [JSON.stringify({ [marker]: marker }), JSON.stringify({ NOTION_CLIENT_SECRET: { token: marker } }),
        JSON.stringify({ NOTION_TOKEN_KEY: marker, NOTION_TOKEN_KEY_ID: 'k2' }), `{ "${marker}":`]) {
        assert.throws(() => parseIntegrationEnvironment(encoded), error => error instanceof Error
            && !String(error).includes(marker) && !JSON.stringify(error).includes(marker));
    }
});

test('oversized maps fail before parsing and do not echo their contents', () => {
    const marker = 'fixture-private-provider-material';
    const encoded = marker.repeat(3000);
    assert.ok(Buffer.byteLength(encoded) > 65_536);
    assert.throws(() => parseIntegrationEnvironment(encoded), error => error instanceof Error
        && error.message === 'UIER_INTEGRATION_ENV is too large.' && !error.message.includes(marker));
});
