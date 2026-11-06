import { createHash } from 'node:crypto';
import type { DbComment } from '../db/schema';

/** Server-only metadata. Neither these rows nor their hashes cross the socket. */
export type RealtimeComment = Pick<DbComment, 'id' | 'domain' | 'path' | 'private' | 'authorId'> & { revision: string };
export const REALTIME_INTERVAL_MS = 2_000;

/** Provider boundary: a future pub/sub provider can replace the shared Cosmos projection. */
export type RealtimeSource = { read: () => Promise<RealtimeComment[]>; release: () => void };

export function visibleRevision(comments: RealtimeComment[], visible: (comment: RealtimeComment) => boolean) {
    const hash = createHash('sha256');
    for (const comment of comments.filter(visible).sort((a, b) => a.id.localeCompare(b.id)))
        hash.update(JSON.stringify([comment.id, comment.revision]));
    return hash.digest('hex');
}

/** Coalesce concurrent sockets per partition/instance. Cosmos remains the cross-instance source. */
export function createRealtimeSources(read: (domain: string) => Promise<RealtimeComment[]>, now = Date.now) {
    const entries = new Map<string, { users: number; at: number; value?: RealtimeComment[]; pending?: Promise<RealtimeComment[]> }>();
    return (domain: string): RealtimeSource => {
        let entry = entries.get(domain);
        if (!entry) { entry = { users: 0, at: 0 }; entries.set(domain, entry); }
        const shared = entry;
        shared.users++;
        let released = false;
        return {
            read: async () => {
                if (released) throw new Error('Realtime subscription ended.');
                if (shared.pending) return shared.pending;
                if (shared.value && now() - shared.at < REALTIME_INTERVAL_MS) return shared.value;
                shared.pending = read(domain).then(value => {
                    shared.at = now(); shared.value = value;
                    return value;
                }).finally(() => { shared.pending = undefined; });
                return shared.pending;
            },
            release: () => {
                if (released) return;
                released = true;
                if (--shared.users === 0) entries.delete(domain);
            }
        };
    };
}
