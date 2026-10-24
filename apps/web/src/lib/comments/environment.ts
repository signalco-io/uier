import { createHmac } from 'node:crypto';

/**
 * Local development and tests: `next dev`, or `UIER_LOCAL=1` (set by playwright.config.ts for
 * `next start`). Only then is BotID skipped and the in-memory store allowed. Everything else,
 * including any deployment that is missing configuration, fails closed.
 */
export function isLocalRuntime() {
    if (process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL)
        return false;

    return process.env.NODE_ENV === 'development' || process.env.UIER_LOCAL === '1';
}

let secret: Buffer | null = null;

/**
 * Server-side key for guest names and rate-limit counter ids, so neither can be computed (or
 * reversed) without it. Derived from the Cosmos DB connection string, which only the server has;
 * rotating the Cosmos key changes guest names, nothing else.
 */
function serverSecret() {
    if (secret == null) {
        const connectionString = process.env.COSMOSDB_CONNECTION_STRING;
        if (!connectionString && !isLocalRuntime())
            throw new Error('COSMOSDB_CONNECTION_STRING is required outside local development.');

        secret = createHmac('sha256', connectionString || 'uier-local-development')
            .update('uier comments v1')
            .digest();
    }

    return secret;
}

/** HMAC-SHA256 of the value with the server secret, hex */
export function keyedHash(purpose: string, value: string) {
    return createHmac('sha256', serverSecret()).update(`${purpose}:${value}`).digest('hex');
}
