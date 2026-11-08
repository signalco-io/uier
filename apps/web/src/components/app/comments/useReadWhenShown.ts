'use client';

import { startTransition, useEffect, useEffectEvent, useRef, type RefObject } from 'react';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import { markCommentReadAction } from './actions';
import { useCommentUpdate } from './CommentUpdates';

/**
 * How long a thread is on screen before it counts as read: the toolbar's dwell, so moving past
 * threads with the arrow keys (or a held key) reads none of them, only the one the reader stops on.
 */
export const readAfterMs = 800;

/**
 * Marks an open thread read for the reader once it has been shown for a moment: on screen (not hidden
 * by the layout, not scrolled away) in a visible, focused window, like the toolbar's open thread.
 *
 * Only someone else's activity is unread, so a read thread writes nothing. It acknowledges the shown
 * sequence, never newer activity, which makes the thread unread again. The dot and the counts change
 * at once (`CommentUpdates`); a failed write puts them back quietly (the dot stays the explicit Mark as
 * read) and is not tried again for that sequence while the thread stays open. `enabled` is off after
 * Mark as unread, so the thread stays unread until it is opened again.
 */
export function useReadWhenShown(ref: RefObject<HTMLElement | null>, projectId: string, comment: ProjectCommentView,
    { enabled, onRead }: { enabled: boolean; onRead?: () => void }) {
    const updateComment = useCommentUpdate();
    // The sequence already sent: one try per sequence, so a failed write does not repeat every dwell
    const sent = useRef<number>(undefined);
    const unreadSequence = comment.activity?.unread ? comment.activity.sequence : undefined;
    const read = useEffectEvent((sequence: number) => {
        sent.current = sequence;
        onRead?.();
        startTransition(async () => {
            updateComment({ id: comment.id, readSequence: sequence });
            // A refused or failed write ends the transition without new data: the optimistic read rolls back
            try { await markCommentReadAction(projectId, comment.id, sequence); }
            catch { /* rolled back */ }
        });
    });
    useEffect(() => {
        const element = ref.current;
        if (!enabled || unreadSequence === undefined || sent.current === unreadSequence || !element) return;
        let timer: number | undefined;
        let shown = false;
        const cancel = () => {
            window.clearTimeout(timer);
            timer = undefined;
        };
        const schedule = () => {
            cancel();
            if (shown && document.visibilityState === 'visible' && document.hasFocus())
                timer = window.setTimeout(() => read(unreadSequence), readAfterMs);
        };
        // A layout that hides the thread (`display: none`) or a page scrolled past it does not count
        const observer = new IntersectionObserver(entries => {
            shown = entries.some(entry => entry.isIntersecting);
            schedule();
        });
        observer.observe(element);
        document.addEventListener('visibilitychange', schedule);
        window.addEventListener('focus', schedule);
        window.addEventListener('blur', cancel);
        return () => {
            cancel();
            observer.disconnect();
            document.removeEventListener('visibilitychange', schedule);
            window.removeEventListener('focus', schedule);
            window.removeEventListener('blur', cancel);
        };
    }, [ref, enabled, unreadSequence]);
}
