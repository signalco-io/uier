import { type Container, CosmosClient, type Database } from '@azure/cosmos';
import { ClientAssertionCredential } from '@azure/identity';
import { getVercelOidcToken } from '@vercel/oidc';

const DATA_DATABASE_NAME = 'uierdata';
export const DEFAULT_COMMENTS_CONTAINER_NAME = 'comments';
export const DEFAULT_APP_CONTAINER_NAME = 'app';

let client: CosmosClient | null = null;
let dataDb: Database | null = null;

let commentsContainer: Container | null = null;
let appContainer: Container | null = null;

/**
 * Cosmos DB is reached in one of two ways (both set by Pulumi, see infra/src/index.ts):
 * - `COSMOSDB_CONNECTION_STRING`: an account key (production, or your own account locally).
 * - `COSMOSDB_ENDPOINT` with `AZURE_TENANT_ID` and `AZURE_CLIENT_ID`: Microsoft Entra ID as a managed
 *   identity that trusts the deployment's Vercel OIDC token (preview deployments). Its only Cosmos DB
 *   roles are on the `comments-preview` and `app-preview` containers, so previews can't touch
 *   production data.
 */
export function isCosmosConfigured() {
    return Boolean(process.env.COSMOSDB_CONNECTION_STRING || process.env.COSMOSDB_ENDPOINT);
}

function entraIdClient(endpoint: string) {
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    if (!tenantId || !clientId)
        throw new Error('COSMOSDB_ENDPOINT needs AZURE_TENANT_ID and AZURE_CLIENT_ID (the managed identity of preview deployments).');

    // The Vercel OIDC token comes from the current request (`x-vercel-oidc-token`), so it is only
    // available while a request is handled. The credential caches the Entra ID access token.
    const credential = new ClientAssertionCredential(tenantId, clientId, () => getVercelOidcToken());
    return new CosmosClient({
        endpoint,
        aadCredentials: credential,
        connectionPolicy: {
            // Single-region account: always use `endpoint`. Endpoint discovery reads account-level
            // metadata and refreshes it in the background, outside any request (no OIDC token there).
            enableEndpointDiscovery: false,
        },
    });
}

function cosmosClient() {
    if (client == null) {
        const connectionString = process.env.COSMOSDB_CONNECTION_STRING;
        const endpoint = process.env.COSMOSDB_ENDPOINT;
        if (connectionString && endpoint)
            throw new Error('Set either COSMOSDB_CONNECTION_STRING or COSMOSDB_ENDPOINT, not both.');

        if (connectionString)
            client = new CosmosClient(connectionString);
        else if (endpoint)
            client = entraIdClient(endpoint);
        else
            throw new Error('Cosmos DB is not configured: set COSMOSDB_CONNECTION_STRING or COSMOSDB_ENDPOINT.');
    }

    return client;
}

function cosmosDataDb() {
    return dataDb = dataDb ?? cosmosClient().database(DATA_DATABASE_NAME);
}

/** Comments container: `COSMOSDB_COMMENTS_CONTAINER` (e.g. `comments-preview` on preview deployments), default `comments` */
export function commentsContainerName() {
    return process.env.COSMOSDB_COMMENTS_CONTAINER?.trim() || DEFAULT_COMMENTS_CONTAINER_NAME;
}

export function cosmosDataContainerComments() {
    return commentsContainer = commentsContainer ?? cosmosDataDb().container(commentsContainerName());
}

/** App data container (users, workspaces, projects, ...): `COSMOSDB_APP_CONTAINER` (`app-preview` on preview deployments), default `app` */
export function appContainerName() {
    return process.env.COSMOSDB_APP_CONTAINER?.trim() || DEFAULT_APP_CONTAINER_NAME;
}

export function cosmosDataContainerApp() {
    return appContainer = appContainer ?? cosmosDataDb().container(appContainerName());
}
