import { randomUUID } from 'node:crypto';
import type { AppDoc } from '../app/model';
import { getAppStore, type AppStore } from '../app/store';

export type GrantLease = { id: string; until: string; generation: number };

/** Structural credential-grant envelope; provider-specific token ciphertext stays on its typed record. */
export type LeasedGrant = AppDoc & {
    provider: string;
    workspaceId: string;
    generation: number;
    status: string;
    refreshLease?: GrantLease;
};

type GrantIdentity = { pk: string; id: string };
type AuthorizedGrant<T extends LeasedGrant> = GrantIdentity & {
    /** Must reload the relevant current admin/binding/installation authority, not use a captured DTO. */
    authorize: (grant: T) => Promise<boolean>;
};

export class GrantLeaseError extends Error {
    constructor(public readonly code: 'busy' | 'invalid_lease' | 'invalid_update' | 'conflict') {
        super('The integration credential is busy or no longer available. Reconnect or try again later.');
        this.name = 'GrantLeaseError';
    }
}

function advancingClock(now: number) {
    const started = Date.now();
    return () => now + Math.max(0, Date.now() - started);
}

function activeGrant(grant: LeasedGrant) {
    return (grant.status === 'connected' || grant.status === 'active')
        && Number.isSafeInteger(grant.generation) && grant.generation >= 0;
}

function ownsLease(grant: LeasedGrant, lease: GrantLease, now: number) {
    return activeGrant(grant) && grant.generation === lease.generation
        && grant.refreshLease?.id === lease.id && grant.refreshLease.generation === lease.generation
        && grant.refreshLease.until === lease.until && Date.parse(lease.until) > now;
}

/** Takes an expiring, generation-fenced lease with conditional replace; never creates a missing grant. */
export async function acquireGrantLease<T extends LeasedGrant>(input: AuthorizedGrant<T> & { leaseMs?: number },
    store: AppStore = getAppStore(), now = Date.now()): Promise<{ grant: T; lease: GrantLease } | null> {
    const currentTime = advancingClock(now);
    const leaseMs = input.leaseMs ?? 2 * 60 * 1000;
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 5 * 60 * 1000)
        throw new GrantLeaseError('invalid_lease');
    for (let attempt = 0; attempt < 8; attempt++) {
        const current = await store.get<T>(input.pk, input.id);
        if (!current || !activeGrant(current.doc) || !await input.authorize(current.doc)) return null;
        if (current.doc.refreshLease && Date.parse(current.doc.refreshLease.until) > currentTime())
            throw new GrantLeaseError('busy');
        const lease: GrantLease = { id: randomUUID(), until: new Date(currentTime() + leaseMs).toISOString(), generation: current.doc.generation };
        const grant = { ...current.doc, refreshLease: lease };
        const saved = await store.replace(grant, current.etag);
        if (saved === 'not_found') return null;
        if (saved === 'ok') {
            // Authority can have changed while acquiring the document lease. Do not return credentials then.
            if (await input.authorize(grant) && ownsLease(grant, lease, currentTime())) return { grant, lease };
            await releaseGrantLease({ pk: input.pk, id: input.id, lease }, store, currentTime());
            return null;
        }
    }
    throw new GrantLeaseError('conflict');
}

/**
 * Re-read and reauthorize immediately before saving an external refresh result. A disconnected,
 * revoked, deleted, replaced or expired grant cannot be resurrected by the earlier refresh call.
 */
export async function saveGrantLease<T extends LeasedGrant>(input: AuthorizedGrant<T> & {
    lease: GrantLease;
    update: (current: T) => T;
}, store: AppStore = getAppStore(), now = Date.now()): Promise<T | null> {
    const currentTime = advancingClock(now);
    for (let attempt = 0; attempt < 8; attempt++) {
        const current = await store.get<T>(input.pk, input.id);
        if (!current || !ownsLease(current.doc, input.lease, currentTime()) || !await input.authorize(current.doc)
            || !ownsLease(current.doc, input.lease, currentTime())) return null;
        const updated = input.update(structuredClone(current.doc));
        if (updated.pk !== current.doc.pk || updated.id !== current.doc.id || updated.type !== current.doc.type
            || updated.provider !== current.doc.provider || updated.workspaceId !== current.doc.workspaceId
            || updated.status !== current.doc.status)
            throw new GrantLeaseError('invalid_update');
        const { refreshLease: _lease, ...withoutLease } = updated;
        const next = { ...withoutLease, generation: current.doc.generation + 1 } as T;
        const saved = await store.replace(next, current.etag);
        if (saved === 'ok') return next;
        if (saved === 'not_found') return null;
    }
    throw new GrantLeaseError('conflict');
}

/** Releases only this exact generation/lease; a newer refresh or revocation always wins. */
export async function releaseGrantLease(input: GrantIdentity & { lease: GrantLease }, store: AppStore = getAppStore(), now = Date.now()) {
    const currentTime = advancingClock(now);
    for (let attempt = 0; attempt < 8; attempt++) {
        const current = await store.get<LeasedGrant>(input.pk, input.id);
        if (!current || !ownsLease(current.doc, input.lease, currentTime())) return false;
        const { refreshLease: _lease, ...next } = current.doc;
        const saved = await store.replace(next, current.etag);
        if (saved === 'ok') return true;
        if (saved === 'not_found') return false;
    }
    throw new GrantLeaseError('conflict');
}
