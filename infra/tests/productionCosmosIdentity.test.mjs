import assert from 'node:assert/strict';
import test from 'node:test';
import { all, runtime } from '@pulumi/pulumi';

const resources = [];
runtime.setMocks({
    newResource(args) {
        resources.push(args);
        return { id: `${args.name}-id`, state: {
            ...args.inputs, name: args.name, principalId: 'production-principal',
            clientId: 'production-client', tenantId: 'fixture-tenant',
        } };
    },
    call(args) { return args.inputs; },
});

test('production federation and keyless runtime settings retain the two production data scopes', async () => {
    const { productionCosmosEnvironment, productionCosmosIdentity } = await import('../dist/productionCosmosIdentity.js');
    const accountId = '/subscriptions/fixture/resourceGroups/uier/providers/Microsoft.DocumentDB/databaseAccounts/uierdb';
    const created = productionCosmosIdentity(
        { name: 'uier-resource-group', location: 'westeurope' },
        { name: 'uierdb', id: accountId },
        'uierdata', { comments: 'comments', app: 'app' },
    );
    await all([created.identity.id, created.federation.id, ...created.assignments.map(role => role.id)]).promise();

    assert.equal(resources.length, 4);
    const federation = resources.find(resource => resource.type.endsWith(':FederatedIdentityCredential')).inputs;
    assert.equal(federation.resourceName, 'uier-production-cosmos');
    assert.equal(federation.issuer, 'https://oidc.vercel.com/signalco');
    assert.equal(federation.subject, 'owner:signalco:project:uier:environment:production');
    assert.deepEqual(federation.audiences, ['https://vercel.com/signalco']);

    const roles = resources.filter(resource => resource.type.endsWith(':SqlResourceSqlRoleAssignment'));
    assert.deepEqual(roles.map(role => role.inputs.scope).sort(), [
        `${accountId}/dbs/uierdata/colls/app`, `${accountId}/dbs/uierdata/colls/comments`,
    ]);
    for (const { inputs } of roles) {
        assert.equal(inputs.principalId, 'production-principal');
        assert.equal(inputs.roleDefinitionId, `${accountId}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002`);
        assert.equal(inputs.accountName, 'uierdb');
        assert.equal(inputs.resourceGroupName, 'uier-resource-group');
    }
    assert.equal(new Set(roles.map(role => role.inputs.roleAssignmentId)).size, 2);

    const variables = productionCosmosEnvironment('uier-project', 'https://fixture.documents.azure.com/', created);
    await all(variables.map(variable => variable.id)).promise();
    assert.equal(resources.length, 7);
    const settings = resources.filter(resource => resource.type.startsWith('vercel:')).map(resource => resource.inputs);
    const values = settings.map(({ key, value }) =>
        [key, value?.['4dabf18193072939515e22adb298388d'] ? value.value : value]);
    assert.deepEqual(Object.fromEntries(values), {
        COSMOSDB_ENDPOINT: 'https://fixture.documents.azure.com/',
        AZURE_TENANT_ID: 'fixture-tenant', AZURE_CLIENT_ID: 'production-client',
    });
    for (const variable of settings) {
        assert.deepEqual(variable.targets, ['production']);
        assert.equal(variable.projectId, 'uier-project');
        assert.equal(variable.teamId, 'team_Ade0MlfC3211ml3wYJZ4c9hn');
        assert.equal(variable.sensitive, false);
    }
});
