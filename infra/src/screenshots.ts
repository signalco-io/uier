import { createHash } from 'node:crypto';
import { all, getStack, interpolate, secret, type Input } from '@pulumi/pulumi';
import { getClientConfigOutput } from '@pulumi/azure-native/authorization/getClientConfig.js';
import { RoleAssignment } from '@pulumi/azure-native/authorization/roleAssignment.js';
import { StorageAccount, BlobContainer, BlobServiceProperties, listStorageAccountKeysOutput } from '@pulumi/azure-native/storage/index.js';
import { ProjectEnvironmentVariable } from '@pulumiverse/vercel';

/** Private image bytes, separate from Cosmos; no CDN or anonymous container access. */
export function screenshotStorage(
    resourceGroup: { name: Input<string>; id: Input<string>; location: Input<string> },
    projectId: Input<string>, previewPrincipal: Input<string>
) {
    const account = new StorageAccount('uier-screenshots', {
        resourceGroupName: resourceGroup.name,
        accountName: all([resourceGroup.id, getStack()]).apply(([id, stack]) => `uierimages${createHash('sha256').update(`${id}:${stack}`).digest('hex').slice(0, 10)}`),
        location: resourceGroup.location,
        kind: 'StorageV2', sku: { name: 'Standard_LRS' }, accessTier: 'Hot',
        allowBlobPublicAccess: false, allowSharedKeyAccess: true, enableHttpsTrafficOnly: true, minimumTlsVersion: 'TLS1_2'
    }, { protect: true });
    new BlobServiceProperties('uier-screenshots-cors', {
        resourceGroupName: resourceGroup.name, accountName: account.name, blobServicesName: 'default',
        cors: { corsRules: [{ allowedOrigins: ['*'], allowedMethods: ['GET', 'HEAD'], allowedHeaders: ['Range', 'Cache-Control', 'Pragma'],
            exposedHeaders: ['Content-Length', 'Content-Type'], maxAgeInSeconds: 0 }] },
        // Replaced/redacted/deleted pixels must not survive as recoverable versions.
        isVersioningEnabled: false, deleteRetentionPolicy: { enabled: false }, containerDeleteRetentionPolicy: { enabled: false }
    }, { protect: true });
    const containers = ['screenshots', 'screenshots-preview'].map(name => new BlobContainer(`uier-${name}`, {
        resourceGroupName: resourceGroup.name, accountName: account.name, containerName: name, publicAccess: 'None'
    }, { protect: true }));
    const preview = containers[1]!;
    const subscription = getClientConfigOutput().subscriptionId;
    const contributor = new RoleAssignment('uier-screenshots-preview-contributor', {
        roleAssignmentName: '70b3fc7b-c23e-4196-a978-b38b1a94e6de', principalId: previewPrincipal, principalType: 'ServicePrincipal',
        roleDefinitionId: interpolate`/subscriptions/${subscription}/providers/Microsoft.Authorization/roleDefinitions/ba92f5b4-2d11-453d-a403-e96b0029c9fe`,
        scope: preview.id
    }, { protect: true });
    const delegator = new RoleAssignment('uier-screenshots-preview-delegator', {
        roleAssignmentName: 'e503df9c-2d65-44f9-ae5d-86c9b8ddfbbb', principalId: previewPrincipal, principalType: 'ServicePrincipal',
        roleDefinitionId: interpolate`/subscriptions/${subscription}/providers/Microsoft.Authorization/roleDefinitions/db58b8e5-c6ad-4a2a-8342-4190687cbf4a`,
        scope: account.id
    }, { protect: true });
    const endpoint = account.primaryEndpoints.apply(endpoints => {
        if (!endpoints?.blob) throw new Error('Screenshot storage has no Blob endpoint.');
        return endpoints.blob;
    });
    new ProjectEnvironmentVariable('vercel-uier-screenshots-endpoint', {
        projectId, key: 'AZURE_SCREENSHOTS_ENDPOINT', value: endpoint, targets: ['production', 'preview'], sensitive: false
    }, { dependsOn: containers });
    for (const [target, name] of [['production', 'screenshots'], ['preview', 'screenshots-preview']] as const) {
        new ProjectEnvironmentVariable(`vercel-uier-screenshots-container-${target}`, {
            projectId, key: 'AZURE_SCREENSHOTS_CONTAINER', value: name, targets: [target], sensitive: false
        }, { dependsOn: [contributor, delegator] });
    }
    const keys = listStorageAccountKeysOutput({ resourceGroupName: resourceGroup.name, accountName: account.name });
    const connection = secret(all([account.name, keys.keys]).apply(([name, values]) => {
        const key = values?.[0]?.value;
        if (!key) throw new Error('Screenshot storage returned no account key.');
        return `DefaultEndpointsProtocol=https;AccountName=${name};AccountKey=${key};EndpointSuffix=core.windows.net`;
    }));
    // Retrievable encrypted value: the scheduled worker pulls production config to migrate/sweep.
    new ProjectEnvironmentVariable('vercel-uier-screenshots-connection', {
        projectId, key: 'AZURE_SCREENSHOTS_CONNECTION_STRING', value: connection, targets: ['production'], sensitive: false
    }, { dependsOn: containers });
    return { account, containers, contributor, delegator };
}
