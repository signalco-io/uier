import { randomUUID } from 'node:crypto';
import type { AppDoc } from '../app/model';
import { getAppStore, type AppStore } from '../app/store';
import { sha256Hex } from '../app/tokens';
import type { PullRequestState } from '../comments/pullRequestLinks';

type CachedState = AppDoc & { type: 'pull-request-cache'; state?: PullRequestState; refreshAt: number; lease?: string };
type Budget = AppDoc & { type: 'pull-request-budget'; start: number; count: number; pausedUntil: number };
const minute = 60_000;
export class PullRequestReadError extends Error {
    constructor(public readonly retryAt = Date.now() + 10 * minute) { super('Pull request state unavailable'); }
}

/** Durable per-authority caches and leases also deduplicate cold reads across server instances. No URLs, titles or tokens. */
export async function cachedPullRequestState(input: { scope: string; url: string; bucket: string; hourlyLimit: number;
    read: () => Promise<PullRequestState | undefined> }, store: AppStore = getAppStore(), now = Date.now()) {
    const pk = `pull-requests:${sha256Hex(input.scope)}`;
    const id = sha256Hex(input.url);
    const previous = await store.get<CachedState>(pk, id);
    if (previous && previous.doc.refreshAt > now)
        return previous.doc.lease ? await waitForState(store, pk, id, previous.doc.lease) : previous.doc.state;
    const lease = randomUUID();
    const pending: CachedState = { pk, id, type: 'pull-request-cache', refreshAt: now + 30_000, lease, ttl: 86400 };
    if (previous ? await store.replace(pending, previous.etag) !== 'ok' : !await store.create(pending)) {
        const current = await store.get<CachedState>(pk, id);
        return current?.doc.lease ? await waitForState(store, pk, id, current.doc.lease) : current?.doc.state;
    }
    let state: PullRequestState | undefined;
    let refreshAt = now + 10 * minute;
    const budgetPk = `pull-request-budget:${sha256Hex(input.bucket)}`;
    try {
        if (await reserveBudget(store, budgetPk, input.hourlyLimit, now)) {
            state = await input.read();
            refreshAt = now + (state ? 5 : 10) * minute;
        }
    } catch (error) {
        if (error instanceof PullRequestReadError) {
            refreshAt = Math.min(now + 86400_000, Math.max(now + 15 * minute, error.retryAt));
            for (let attempt = 0; attempt < 5; attempt++) {
                const budget = await store.get<Budget>(budgetPk, 'budget');
                if (!budget || await store.replace({ ...budget.doc, pausedUntil: Math.max(budget.doc.pausedUntil, refreshAt) }, budget.etag) === 'ok') break;
            }
        }
        // Provider failures are intentionally a plain link, with no provider text or error in the DTO.
    }
    const current = await store.get<CachedState>(pk, id);
    if (current?.doc.lease === lease) await store.replace({ pk, id, type: 'pull-request-cache', state, refreshAt, ttl: 86400 }, current.etag);
    return state;
}

/** A simultaneous view joins the existing read instead of displaying an empty state for five minutes. */
async function waitForState(store: AppStore, pk: string, id: string, lease: string) {
    for (const delay of [100, 300, 800, 1800, 3000, 4000]) {
        await new Promise(resolve => setTimeout(resolve, delay));
        const current = await store.get<CachedState>(pk, id);
        if (!current || current.doc.lease !== lease) return current?.doc.state;
    }
    return undefined;
}

async function reserveBudget(store: AppStore, pk: string, limit: number, now: number) {
    for (let attempt = 0; attempt < 5; attempt++) {
        const previous = await store.get<Budget>(pk, 'budget');
        if (previous && previous.doc.pausedUntil > now) return false;
        const window = previous && previous.doc.start + 3600_000 > now ? previous.doc : { start: now, count: 0, pausedUntil: 0 };
        if (window.count >= limit) return false;
        const doc: Budget = { ...window, pk, id: 'budget', type: 'pull-request-budget', count: window.count + 1, ttl: 86400 };
        if (previous ? await store.replace(doc, previous.etag) === 'ok' : await store.create(doc)) return true;
    }
    return false;
}
