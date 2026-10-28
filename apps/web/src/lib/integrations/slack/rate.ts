import type { AppDoc } from '../../app/model';
import { randomUUID } from 'node:crypto';
import { getAppStore, updateDoc } from '../../app/store';
import { sha256Hex } from '../../app/tokens';
import { SlackApiError, type SlackMethod } from './client';

type Identity = { appId: string; teamId: string };
export type SlackRateBucket = AppDoc & { type: 'slack-rate'; nextAt: number; pausedUntil: number; requiresReview?: boolean;
    reviewRelease?: { id: string; at: string }; inFlight?: { id: string; until: number } };
export class SlackRateWait extends Error {
    constructor(public readonly retryAt: string) { super('Slack requests must wait.'); this.name = 'SlackRateWait'; }
}
export const slackRatePk = (identity: Identity) => `slack-rate:${sha256Hex(`${identity.appId}:${identity.teamId}`)}`;

/** Cross-process buckets are app/workspace scoped, so sibling projects cannot evade a cooldown. */
export async function withSlackRateLimit<T>(identity: Identity, method: SlackMethod, channelId: string | undefined,
    send: () => Promise<T>, deadline = Date.now() + 20_000) {
    const store = getAppStore(); const pk = slackRatePk(identity);
    let channelLease: { id: string; nonce: string } | undefined;
    const methodId = `method_${method.replaceAll('.', '_')}`;
    const methodBucket = (await store.get<SlackRateBucket>(pk, methodId))?.doc;
    if (methodBucket?.requiresReview) throw new SlackApiError(429, 'rate_limit_requires_review', undefined, true, method);
    if ((methodBucket?.pausedUntil ?? 0) > Date.now()) throw new SlackRateWait(new Date(methodBucket!.pausedUntil).toISOString());
    if (method === 'chat.postMessage' && channelId) {
        const id = `channel_${channelId}`;
        const nonce = randomUUID();
        await store.create<SlackRateBucket>({ type: 'slack-rate', pk, id, nextAt: 0, pausedUntil: 0 });
        let reserved = 0;
        await updateDoc<SlackRateBucket>(pk, id, current => {
            const now = Date.now();
            if (current.inFlight && current.inFlight.until > now) throw new SlackRateWait(new Date(current.inFlight.until).toISOString());
            reserved = Math.max(now, current.nextAt, current.pausedUntil);
            // Do not allocate an ever-growing queue or sleep through this provider's fair turn.
            if (reserved > now + 1500 || reserved + 100 >= deadline) throw new SlackRateWait(new Date(reserved).toISOString());
            return { ...current, nextAt: reserved + 1100, inFlight: { id: nonce, until: deadline + 30_000 } };
        });
        channelLease = { id, nonce };
        if (reserved > Date.now()) await new Promise(resolve => setTimeout(resolve, reserved - Date.now()));
    }
    try {
        if (Date.now() >= deadline) throw new SlackRateWait(new Date(Date.now() + 1000).toISOString());
        const latest = (await store.get<SlackRateBucket>(pk, methodId))?.doc;
        if (latest?.requiresReview) throw new SlackApiError(429, 'rate_limit_requires_review', undefined, true, method);
        if ((latest?.pausedUntil ?? 0) > Date.now()) throw new SlackRateWait(new Date(latest!.pausedUntil).toISOString());
        return await send();
    }
    catch (error) {
        if (error instanceof SlackApiError && (!error.method || error.method === method) && ['ratelimited', 'rate_limit_requires_review'].includes(error.code)) {
            const requiresReview = error.code === 'rate_limit_requires_review';
            const pausedUntil = requiresReview ? 0 : Date.now() + (error.retryAfter ?? 60) * 1000;
            if (!await store.create<SlackRateBucket>({ type: 'slack-rate', pk, id: methodId, nextAt: 0, pausedUntil, requiresReview }))
                await updateDoc<SlackRateBucket>(pk, methodId, current => ({ ...current, pausedUntil: Math.max(current.pausedUntil, pausedUntil),
                    requiresReview: current.requiresReview === true || requiresReview }));
        }
        throw error;
    } finally {
        // Measure the next slot from completion, including slow authority checks and network calls.
        // A failed release leaves a conservative lease; it must never discard an accepted response.
        if (channelLease) await updateDoc<SlackRateBucket>(pk, channelLease.id, current => current.inFlight?.id !== channelLease!.nonce ? current
            : ({ ...current, inFlight: undefined, nextAt: Math.max(current.nextAt, Date.now() + 1100) })).catch(() => undefined);
    }
}
