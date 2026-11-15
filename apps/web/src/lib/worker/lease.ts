import { randomUUID } from 'node:crypto';
import type { AppDoc } from '../app/model';
import { getAppStore, type AppStore } from '../app/store';

// Both hosts hard-stop before this expires: Vercel at 800s, Actions at 13 minutes.
// Never race a timeout against unfinished work and release the lease early.
export const WORKER_LEASE_MS = 15 * 60_000;
export const WORKER_BUDGET_MS = 12 * 60_000;
const pk = 'worker:review-notifications', id = 'review-notifications';
type WorkerLease = AppDoc & { type: 'worker-lease'; owner: string; until: number; startedAt: string; finishedAt?: string };

/** One cross-instance lease, shared by native schedules and privileged manual recovery. */
export async function acquireWorkerLease(store: AppStore = getAppStore(), now = Date.now()) {
    const owner = randomUUID();
    const next: WorkerLease = { type: 'worker-lease', pk, id, owner, until: now + WORKER_LEASE_MS, startedAt: new Date(now).toISOString() };
    for (let attempt = 0; attempt < 4; attempt++) {
        const previous = await store.get<WorkerLease>(pk, id);
        if (!previous) {
            if (await store.create(next)) return { owner, until: next.until };
            continue;
        }
        if (previous.doc.type !== 'worker-lease' || !Number.isFinite(previous.doc.until))
            throw new Error('The scheduled worker lease is invalid.');
        if (previous.doc.until > now) return null;
        if (await store.replace(next, previous.etag) === 'ok') return { owner, until: next.until };
    }
    return null;
}

/** Conditional release cannot clear a successor's lease, even after an expired invocation. */
export async function releaseWorkerLease(owner: string, store: AppStore = getAppStore(), now = Date.now()) {
    const current = await store.get<WorkerLease>(pk, id);
    if (!current || current.doc.owner !== owner) return;
    await store.replace({ ...current.doc, until: 0, finishedAt: new Date(now).toISOString() }, current.etag);
}
