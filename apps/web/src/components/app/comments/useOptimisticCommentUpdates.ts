'use client';

import { useOptimistic, useRef, useState } from 'react';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import { applyCommentUpdate, type CommentUpdate, type ConfirmCommentUpdate } from './CommentUpdates';
import { commentWriteObserved, commentWrites, latestCommentWrites, type CommentWrite } from './commentUpdateAcknowledgement';

type ScopedWrite = CommentWrite & { scope: string };
const noWrites: ScopedWrite[] = [];
type Confirmed = { scope: string; writes: CommentWrite[]; settled: Record<string, number> };

/**
 * Transitions cover the write, not the independent paged/detail reads it invalidates. Keep confirmed
 * fields over those older snapshots until this projection observes the write. Unconfirmed changes
 * still roll back with their transition. Never insert a row absent from the authorized snapshot.
 */
export function useOptimisticCommentUpdates(saved: ProjectCommentView[], scope: string) {
    const order = useRef(0);
    const [confirmed, setConfirmed] = useState<Confirmed>({ scope, writes: [], settled: {} });
    const current = confirmed.scope === scope ? confirmed : { scope, writes: [], settled: {} };
    const remaining = current.writes.filter(write => !commentWriteObserved(write, saved));
    if (confirmed.scope !== scope || remaining.length !== current.writes.length) setConfirmed({ ...current, writes: remaining });
    const [pending, addPending] = useOptimistic(noWrites, (writes, next: ScopedWrite[]) => [...writes, ...next]);
    const writes = latestCommentWrites([...remaining, ...pending.filter(write => write.scope === scope)], current.settled);
    const comments = saved.map(comment => writes.reduce((shown, write) => applyCommentUpdate(shown, write.update), comment));
    const update = (change: CommentUpdate): ConfirmCommentUpdate => {
        const writes = commentWrites(change, ++order.current, saved.find(comment => comment.id === change.id)).map(write => ({ ...write, scope }));
        addPending(writes);
        return (receipt, options) => setConfirmed(current => {
            if (current.scope !== scope) return current;
            const settled = { ...current.settled };
            for (const write of writes) settled[write.key] = Math.max(settled[write.key] ?? 0, write.order);
            const savedWrites = options?.retain === false ? [] : writes.map(write => ({ ...write, commentSequence: receipt?.commentSequence }));
            return { scope, settled, writes: latestCommentWrites([...current.writes, ...savedWrites], settled) };
        });
    };
    return [comments, update] as const;
}
