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
 * reversed) without it: `UIER_COMMENTS_SECRET`, a random value Pulumi sets for each Vercel target.
 * The app signs its session tokens with keys derived from it too (src/lib/app/tokens.ts). Changing it
 * changes guest names and signs everyone out of the app. Locally a fixed development key is used.
 */
function serverSecret() {
    if (secret == null) {
        const value = process.env.UIER_COMMENTS_SECRET;
        if (!value && !isLocalRuntime())
            throw new Error('UIER_COMMENTS_SECRET is required outside local development.');
        if (value && value.length < 32)
            throw new Error('UIER_COMMENTS_SECRET must be at least 32 characters.');

        secret = createHmac('sha256', value || 'uier-local-development')
            .update('uier comments v1')
            .digest();
    }

    return secret;
}

/** HMAC-SHA256 of the value with the server secret, hex */
export function keyedHash(purpose: string, value: string) {
    return createHmac('sha256', serverSecret()).update(`${purpose}:${value}`).digest('hex');
}
