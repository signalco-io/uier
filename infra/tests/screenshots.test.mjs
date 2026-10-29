import assert from 'node:assert/strict';
import test from 'node:test';
import { all, runtime } from '@pulumi/pulumi';
const resources = [];
runtime.setMocks({
    newResource(args) {
        resources.push(args);
        return { id: `/subscriptions/fixture/${args.name}`, state: { ...args.inputs,
            name: args.inputs.accountName ?? args.name, primaryEndpoints: { blob: 'https://fixture.blob.core.windows.net/' } } };
    },
    call(args) {
        if (args.token.includes('getClientConfig')) return { subscriptionId: 'fixture', tenantId: 'fixture', clientId: 'fixture', objectId: 'fixture' };
        if (args.token.includes('listStorageAccountKeys')) return { keys: [{ value: 'fixture-not-a-real-key' }] };
        return args.inputs;
    }
});
test('screenshots are private with read-only CORS and preview data access only on its own container', async () => {
    const { screenshotStorage } = await import('../dist/screenshots.js');
    const created = screenshotStorage({ name: 'uier', id: '/subscriptions/fixture/resourceGroups/uier', location: 'westeurope' }, 'project', 'preview-principal');
    await all([created.account.id, ...created.containers.map(container => container.id), created.contributor.id, created.delegator.id]).promise();
    // Environment resources are registered after their inputs resolve.
    await new Promise(resolve => setImmediate(resolve));
    const account = resources.find(item => item.type.endsWith(':StorageAccount')).inputs;
    assert.equal(account.allowBlobPublicAccess, false);
    assert.equal(account.enableHttpsTrafficOnly, true);
    assert.equal(account.accessTier, 'Hot');
    assert.equal(account.sku.name, 'Standard_LRS');
    const service = resources.find(item => item.type.endsWith(':BlobServiceProperties')).inputs;
    assert.equal(service.isVersioningEnabled, false);
    assert.equal(service.deleteRetentionPolicy.enabled, false);
    assert.deepEqual(service.cors.corsRules[0].allowedMethods, ['GET', 'HEAD']);
    for (const container of resources.filter(item => item.type.endsWith(':BlobContainer'))) assert.equal(container.inputs.publicAccess, 'None');
    const contributor = resources.find(item => item.name.endsWith('preview-contributor')).inputs;
    assert.equal(contributor.scope, '/subscriptions/fixture/uier-screenshots-preview');
    assert.equal(contributor.principalId, 'preview-principal');
    const connection = resources.find(item => item.name === 'vercel-uier-screenshots-connection').inputs;
    assert.deepEqual(connection.targets, ['production']);
    assert.equal(resources.filter(item => item.type.endsWith(':StorageAccount')).length, 1);
    assert.equal(resources.some(item => /cdn|frontdoor/i.test(item.type)), false);
});
