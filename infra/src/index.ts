import { Config, getStack, interpolate } from '@pulumi/pulumi';
import { RandomBytes } from '@pulumi/random';
import { ProjectDomain, ProjectEnvironmentVariable } from '@pulumiverse/vercel';
import { ResourceGroup } from '@pulumi/azure-native/resources/index.js';
import { DatabaseAccount, SqlResourceSqlDatabase, SqlResourceSqlContainer, SqlResourceSqlRoleAssignment, DatabaseAccountOfferType, listDatabaseAccountConnectionStringsOutput } from '@pulumi/azure-native/cosmosdb/index.js';
import { FederatedIdentityCredential, UserAssignedIdentity } from '@pulumi/azure-native/managedidentity/index.js';
import { nextJsApp } from './vercel.js';
import { dnsRecord } from './cloudflare.js';
import { acsEmail } from './email.js';

const up = async () => {
    // Only the production stack (branch main, uier.io) is deployed. The former uier-next stack
    // (next.uier.io) was decommissioned when uier moved out of the signalco monorepo.
    const stack = getStack().replace('uier-', '');
    if (stack !== 'production')
        throw new Error(`Unsupported stack "${getStack()}": only uier-production is deployed.`);

    // Every push to main runs `pulumi up` without an approval step. `protect` makes Pulumi refuse to
    // delete or replace the resources that hold data or serve uier.io (a replace-triggering change,
    // a renamed logical name, or a removed resource fails instead). Unprotect deliberately first
    // (`pulumi state unprotect` or `protect: false` in its own deploy) when that is really intended.
    const protect = true;

    // Vercel team slug and project name: the claims of the project's OIDC tokens (see below).
    const vercelTeamSlug = 'signalco';
    const vercelProjectName = 'uier';
    const app = nextJsApp('uier', vercelProjectName, 'apps/web', protect);

    // Configure domain name
    const domain = new ProjectDomain('vercel-uier-domain', {
        projectId: app.projectId,
        domain: 'uier.io',
    });
    dnsRecord('vercel-uier', '@', '76.76.21.21', 'A', protect);

    // www.uier.io only redirects to uier.io (permanently, keeping the path and query).
    // Not protected: it serves no content and can be recreated at any time.
    new ProjectDomain('vercel-uier-domain-www', {
        projectId: app.projectId,
        domain: 'www.uier.io',
        redirect: domain.domain,
        redirectStatusCode: 308,
    });
    dnsRecord('vercel-uier-www', 'www', 'cname.vercel-dns.com', 'CNAME', false);

    // Azure
    const resourceGroupName = `uier-${stack}`;
    const resourceGroup = new ResourceGroup(resourceGroupName, {}, { protect });

    // The toolbar bundle needs no storage account or CDN of its own: the web app serves it at
    // https://uier.io/toolbar.js and Vercel's CDN caches it (apps/web/next.config.ts).

    // Create an Azure Cosmos DB Account for SQL API
    // Aliases: @pulumi/azure-native 2.x named this module `documentdb`; state written by 2.x
    // migrates to the 3.x `cosmosdb` type token instead of being replaced. The 3.x SDK declares
    // the same aliases itself; they are repeated here so the migration does not depend on it.
    const cosmosAccountName = 'uierdb';
    const databaseName = 'uierdata';
    const cosmosDbAccount = new DatabaseAccount(cosmosAccountName, {
        resourceGroupName: resourceGroup.name,
        databaseAccountOfferType: DatabaseAccountOfferType.Standard,
        capabilities: [
            {
                name: 'EnableServerless', // Use specific capabilities if needed
            },
        ],
        consistencyPolicy: {
            defaultConsistencyLevel: 'Session', // Adjust the consistency level as needed
        },
        locations: [
            { locationName: 'West Europe' },
        ],
    }, {
        protect,
        aliases: [{ type: 'azure-native:documentdb:DatabaseAccount' }],
    });
    const cosmosConnectionStrings = listDatabaseAccountConnectionStringsOutput({
        resourceGroupName: resourceGroup.name,
        accountName: cosmosDbAccount.name,
    });
    // Production only. Preview deployments get no account key (an account key can read and write
    // every container); they use the managed identity below.
    const cosmosPrimaryConnectionString = cosmosConnectionStrings
        .apply(keys => keys.connectionStrings?.at(0)?.connectionString ?? '');

    // Create a SQL Database within the Cosmos DB Account
    const sqlDatabase = new SqlResourceSqlDatabase(databaseName, {
        resourceGroupName: resourceGroup.name,
        accountName: cosmosDbAccount.name,
        resource: {
            id: databaseName,
        },
    }, {
        protect,
        aliases: [{ type: 'azure-native:documentdb:SqlResourceSqlDatabase' }],
    });

    // Creating the containers inside the database
    // `defaultTtl` turns on Cosmos DB time to live (an in-place container update, existing items
    // are kept): -1 = items never expire by default, only items with their own `ttl` field do;
    // a positive value = every item expires that many seconds after its last write unless its own
    // `ttl` says otherwise (a per-item `ttl` always overrides the container default).
    const sqlContainer = (containerName: string, defaultTtl: number, partitionKeyPath = '/domain') =>
        new SqlResourceSqlContainer(`dbcontainer-${containerName}`, {
            resourceGroupName: resourceGroup.name,
            accountName: cosmosDbAccount.name,
            databaseName: sqlDatabase.name,
            containerName: containerName,
            resource: {
                id: containerName,
                partitionKey: {
                    kind: 'Hash',
                    paths: [partitionKeyPath],
                },
                defaultTtl,
            },
        }, {
            protect,
            aliases: [{ type: 'azure-native:documentdb:SqlResourceSqlContainer' }],
        });
    // Production comments; anonymous showcase comments carry their own `ttl` (90 days).
    const commentsContainer = sqlContainer('comments', -1);
    // Comments written by PR preview deployments: 7 days, as long as items carry no longer `ttl`.
    const commentsPreviewContainer = sqlContainer('comments-preview', 7 * 24 * 60 * 60);
    // The app's own data (users, workspaces, projects, invitations, sign-in links), partitioned by the
    // generic `/pk` (apps/web/src/lib/app/model.ts). Short-lived items (sign-in links) carry a `ttl`.
    const appContainer = sqlContainer('app', -1, '/pk');
    // App data written by PR preview deployments: 7 days after the last write.
    const appPreviewContainer = sqlContainer('app-preview', 7 * 24 * 60 * 60, '/pk');

    // Preview deployments reach Cosmos DB as this managed identity, without a key: it trusts the
    // Vercel OIDC token of the project's preview deployments (workload identity federation) and its
    // only Cosmos DB role is on the `comments-preview` container.
    const previewIdentity = new UserAssignedIdentity('uier-preview-cosmos', {
        resourceGroupName: resourceGroup.name,
        location: resourceGroup.location,
    });
    // The project uses Vercel's team issuer mode (Project settings -> Security -> OIDC Federation);
    // `sub` and the default `aud` follow https://vercel.com/docs/oidc/reference. Renaming the team or
    // the project, or switching to the global issuer (`https://oidc.vercel.com`), changes the claims:
    // Entra ID then rejects the token and the preview comments API fails (500) until this is updated.
    new FederatedIdentityCredential('vercel-uier-preview', {
        resourceGroupName: resourceGroup.name,
        resourceName: previewIdentity.name,
        issuer: `https://oidc.vercel.com/${vercelTeamSlug}`,
        subject: `owner:${vercelTeamSlug}:project:${vercelProjectName}:environment:preview`,
        audiences: [`https://vercel.com/${vercelTeamSlug}`],
    });
    // Cosmos DB data plane RBAC: "Cosmos DB Built-in Data Contributor" (items and queries, no database
    // or container management) on `comments-preview` only. The assignment id is an arbitrary fixed GUID.
    new SqlResourceSqlRoleAssignment('uierdb-preview-comments-contributor', {
        resourceGroupName: resourceGroup.name,
        accountName: cosmosDbAccount.name,
        roleAssignmentId: '4d692441-6767-45ee-a826-e326f532a48c',
        roleDefinitionId: interpolate`${cosmosDbAccount.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002`,
        principalId: previewIdentity.principalId,
        scope: interpolate`${cosmosDbAccount.id}/dbs/${sqlDatabase.name}/colls/${commentsPreviewContainer.name}`,
    });
    // The same role on `app-preview`, the previews' app data (another fixed GUID)
    new SqlResourceSqlRoleAssignment('uierdb-preview-app-contributor', {
        resourceGroupName: resourceGroup.name,
        accountName: cosmosDbAccount.name,
        roleAssignmentId: 'b1d5c0b8-6f0e-4b7a-9a43-2f6c0f1e7d35',
        roleDefinitionId: interpolate`${cosmosDbAccount.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002`,
        principalId: previewIdentity.principalId,
        scope: interpolate`${cosmosDbAccount.id}/dbs/${sqlDatabase.name}/colls/${appPreviewContainer.name}`,
    });

    // Email (sign-in links and invitations), production only: like the account key, the email key
    // stays out of previews (they show sign-in links on the page instead, apps/web/src/lib/email/send.ts).
    const email = acsEmail('uier', resourceGroup);

    // Key for guest names and rate-limit counter ids (apps/web/src/lib/comments/environment.ts), one
    // per target so previews know nothing about production. Replacing one changes that target's guest names.
    const commentsSecret = (name: string) => new RandomBytes(name, { length: 32 }).base64;

    // Assign app environment variables
    // Production and preview deployments get separate variables (disjoint targets): production uses
    // the primary key, previews the managed identity and their own container.
    // Vercel allows one variable per key and target, so a replace of the new variables (a changed
    // `key` or `sensitive`) has to delete the old one first; variables apply to new deployments only.
    const envVarOptions = { deleteBeforeReplace: true };
    new ProjectEnvironmentVariable('vercel-uier-env-cosmos', {
        projectId: app.projectId,
        key: 'COSMOSDB_CONNECTION_STRING',
        value: cosmosPrimaryConnectionString,
        targets: ['production'],
        // Required (and replace-on-change) since @pulumiverse/vercel 4.8. Older providers stored
        // `sensitive = (type == "sensitive")` after creating the variable without it (type "encrypted"
        // unless a team policy forces sensitive). It must equal the value in state, or Pulumi plans a
        // replace (which fails safely with ENV_CONFLICT, as create runs before delete).
        sensitive: false,
    });
    new ProjectEnvironmentVariable('vercel-uier-env-cosmos-container', {
        projectId: app.projectId,
        key: 'COSMOSDB_COMMENTS_CONTAINER',
        value: commentsContainer.name,
        targets: ['production'],
        // A container name, not a secret ("Config" in the Vercel dashboard).
        sensitive: false,
    }, envVarOptions);
    new ProjectEnvironmentVariable('vercel-uier-env-comments-secret', {
        projectId: app.projectId,
        key: 'UIER_COMMENTS_SECRET',
        value: commentsSecret('uier-comments-secret'),
        targets: ['production'],
        // "Secret" in the Vercel dashboard: write-only, only deployments can read it.
        sensitive: true,
    }, envVarOptions);
    new ProjectEnvironmentVariable('vercel-uier-env-cosmos-endpoint-preview', {
        projectId: app.projectId,
        key: 'COSMOSDB_ENDPOINT',
        value: cosmosDbAccount.documentEndpoint,
        targets: ['preview'],
        sensitive: false,
    }, envVarOptions);
    // Tenant and client id of the managed identity: identifiers, not credentials (only a preview
    // deployment's OIDC token gets a token for them).
    new ProjectEnvironmentVariable('vercel-uier-env-azure-tenant-preview', {
        projectId: app.projectId,
        key: 'AZURE_TENANT_ID',
        value: previewIdentity.tenantId,
        targets: ['preview'],
        sensitive: false,
    }, envVarOptions);
    new ProjectEnvironmentVariable('vercel-uier-env-azure-client-preview', {
        projectId: app.projectId,
        key: 'AZURE_CLIENT_ID',
        value: previewIdentity.clientId,
        targets: ['preview'],
        sensitive: false,
    }, envVarOptions);
    new ProjectEnvironmentVariable('vercel-uier-env-cosmos-container-preview', {
        projectId: app.projectId,
        key: 'COSMOSDB_COMMENTS_CONTAINER',
        value: commentsPreviewContainer.name,
        targets: ['preview'],
        sensitive: false,
    }, envVarOptions);
    new ProjectEnvironmentVariable('vercel-uier-env-comments-secret-preview', {
        projectId: app.projectId,
        key: 'UIER_COMMENTS_SECRET',
        value: commentsSecret('uier-comments-secret-preview'),
        targets: ['preview'],
        sensitive: true,
    }, envVarOptions);
    new ProjectEnvironmentVariable('vercel-uier-env-cosmos-app-container', {
        projectId: app.projectId,
        key: 'COSMOSDB_APP_CONTAINER',
        value: appContainer.name,
        targets: ['production'],
        sensitive: false,
    }, envVarOptions);
    new ProjectEnvironmentVariable('vercel-uier-env-cosmos-app-container-preview', {
        projectId: app.projectId,
        key: 'COSMOSDB_APP_CONTAINER',
        value: appPreviewContainer.name,
        targets: ['preview'],
        sensitive: false,
    }, envVarOptions);
    new ProjectEnvironmentVariable('vercel-uier-env-acs', {
        projectId: app.projectId,
        key: 'ACS_CONNECTION_STRING',
        value: email.connectionString,
        targets: ['production'],
        sensitive: true,
    }, envVarOptions);
    new ProjectEnvironmentVariable('vercel-uier-env-email-sender', {
        projectId: app.projectId,
        key: 'UIER_EMAIL_SENDER',
        value: email.senderAddress,
        targets: ['production'],
        sensitive: false,
    }, envVarOptions);

    // Rewrite suggestions in the toolbar (apps/web/src/lib/rewrite/suggest.ts) call the Anthropic API.
    // Its key is a stack secret set by hand: `pulumi config set anthropicApiKey --secret` (asks for it). Without
    // it no variable is created and the toolbar says suggestions are not available. Production only.
    const anthropicApiKey = new Config().getSecret('anthropicApiKey');
    if (anthropicApiKey) {
        new ProjectEnvironmentVariable('vercel-uier-env-anthropic', {
            projectId: app.projectId,
            key: 'ANTHROPIC_API_KEY',
            value: anthropicApiKey,
            targets: ['production'],
            sensitive: true,
        }, envVarOptions);
    }
};

export default up;
