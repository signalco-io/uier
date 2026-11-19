import { proofApiPath, type ProofScope } from '@/src/lib/proofs/model';

export class ProofRequestError extends Error {
    constructor(readonly status: number, message: string) {
        super(message);
    }
}

export function proofErrorMessage(error: unknown) {
    return error instanceof ProofRequestError ? error.message : 'The request could not be completed.';
}

export async function proofFetch<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, { cache: 'no-store', ...init });
    if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: unknown; message?: unknown } | null;
        const message = [body?.message, body?.error].find((value): value is string => typeof value === 'string');
        throw new ProofRequestError(response.status, message ?? 'The request could not be completed.');
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
}

export function proofWrite<T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
    return proofFetch<T>(path, body === undefined ? { method } : {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
}

const exchangeRequests = new Map<string, Promise<unknown>>();

/** The fragment is consumed before fetching anything with the previous session's scope. */
export async function exchangeProofLink(projectId: string) {
    const url = new URL(window.location.href);
    const fragment = new URLSearchParams(url.hash.slice(1));
    const approval = fragment.get('approval');
    const token = approval ?? fragment.get('share');
    if (!token) return;
    const path = proofApiPath(projectId) + (approval ? '/approvals' : '/exchange');
    const key = JSON.stringify([path, token]);
    let request = exchangeRequests.get(key);
    if (!request) {
        request = proofWrite<{ scope: ProofScope } | { assetId: string; versionId: string }>(path, 'POST', { token }).finally(() => exchangeRequests.delete(key));
        exchangeRequests.set(key, request);
    }
    try {
        await request;
    } finally {
        // A temporary network failure can be retried from the original link. Never put the grant in a request URL.
        if (window.location.hash === url.hash)
            window.history.replaceState(null, '', url.pathname + url.search);
    }
}
