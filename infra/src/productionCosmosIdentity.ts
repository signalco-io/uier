import { interpolate, type Input } from '@pulumi/pulumi';
import { FederatedIdentityCredential, UserAssignedIdentity } from '@pulumi/azure-native/managedidentity/index.js';
import { ProjectEnvironmentVariable } from '@pulumiverse/vercel';
import { vercelTeamId } from './vercelScope.js';
import { SqlResourceSqlRoleAssignment } from '@pulumi/azure-native/cosmosdb/index.js';

/** Separate, protected production data identity; see docs/ci-credential-rollout.md. */
export function productionCosmosIdentity(
    resourceGroup: { name: Input<string>; location: Input<string> },
    account: { name: Input<string>; id: Input<string> },
    databaseName: Input<string>,
    containers: { comments: Input<string>; app: Input<string> },
) {
    const identity = new UserAssignedIdentity('uier-production-cosmos', {
        resourceGroupName: resourceGroup.name,
        location: resourceGroup.location,
    }, { protect: true });
    const federation = new FederatedIdentityCredential('vercel-uier-production', {
        resourceGroupName: resourceGroup.name,
        resourceName: identity.name,
        issuer: 'https://oidc.vercel.com/signalco',
        subject: 'owner:signalco:project:uier:environment:production',
        audiences: ['https://vercel.com/signalco'],
    }, { protect: true });

    // Data-plane rights on these two containers only. No database/container management role,
    // preview-container scope, GitHub subject, or account-wide assignment.
    const assignments = Object.entries(containers).map(([kind, container]) =>
        new SqlResourceSqlRoleAssignment(`uierdb-production-${kind}-contributor`, {
            resourceGroupName: resourceGroup.name,
            accountName: account.name,
            roleAssignmentId: kind === 'comments'
                ? '98770b64-26db-47cd-a812-dc052db393fc'
                : 'b0f07875-a24c-4c0e-94d6-5e156e48e3a8',
            roleDefinitionId: interpolate`${account.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002`,
            principalId: identity.principalId,
            scope: interpolate`${account.id}/dbs/${databaseName}/colls/${container}`,
        }, { protect: true }));

    return { identity, federation, assignments };
}

/** Activate only the prepared production identity; no account key enters the runtime settings. */
export function productionCosmosEnvironment(
    projectId: Input<string>, endpoint: Input<string>, prepared: ReturnType<typeof productionCosmosIdentity>,
) {
    return ([
        ['cosmos-endpoint', 'COSMOSDB_ENDPOINT', endpoint],
        ['azure-tenant', 'AZURE_TENANT_ID', prepared.identity.tenantId],
        ['azure-client', 'AZURE_CLIENT_ID', prepared.identity.clientId],
    ] as const).map(([name, key, value]) => new ProjectEnvironmentVariable(`vercel-uier-env-${name}-production`, {
        teamId: vercelTeamId, projectId, key, value, targets: ['production'], sensitive: false,
    }, { deleteBeforeReplace: true, dependsOn: [prepared.federation, ...prepared.assignments] }));
}
