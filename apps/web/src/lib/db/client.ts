import { type Container, CosmosClient, type Database } from '@azure/cosmos';

const DATA_DATABASE_NAME = 'uierdata';
export const DEFAULT_COMMENTS_CONTAINER_NAME = 'comments';

let client: CosmosClient | null = null;
let dataDb: Database | null = null;

let commentsContainer: Container | null = null;

export function isCosmosConfigured() {
    return Boolean(process.env.COSMOSDB_CONNECTION_STRING);
}

function cosmosClient() {
    if (client == null) {
        const connectionString = process.env.COSMOSDB_CONNECTION_STRING;
        if (!connectionString)
            throw new Error('COSMOSDB_CONNECTION_STRING is not available in the environment. Please set it before using this feature.');

        client = new CosmosClient(connectionString);
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
