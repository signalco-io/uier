import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@signalco/ui-primitives/Button';
import { Input } from '@signalco/ui-primitives/Input';
import { toolbarConfig } from '../config';
import { apiRequest, commentsQueryKeyPrefix } from '../hooks/api';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import type { CommentItem } from './@types/Comments';
import { useAnnounce } from './Announcer';

const quietButtonClassName = '-ml-2 font-normal text-muted-foreground hover:text-foreground';

function followUrl(comment: CommentItem) {
    return `${toolbarConfig.apiUrl}/api/review/${toolbarConfig.project}/comments/${encodeURIComponent(comment.id)}/notifications`;
}

/**
 * A member's email controls for the thread's options menu: follow or unfollow it and mute the
 * project's email. Owners and admins get new feedback; members follow threads they post in; replies
 * and status changes are batched for 5 minutes. Nothing for guests (`ThreadNotifications`).
 */
export function useThreadNotificationActions(comment: CommentItem) {
    const client = useQueryClient();
    const announce = useAnnounce();
    const state = comment.notifications;
    const follow = useMutation({
        mutationFn: async (following: boolean) => apiRequest(followUrl(comment), { method: 'POST', body: { following } }),
        onSuccess: async (_result, following) => { announce(following ? 'You follow this thread now' : 'You no longer follow this thread'); await client.invalidateQueries({ queryKey: commentsQueryKeyPrefix }); }
    });
    const mute = useMutation({
        mutationFn: async () => apiRequest(`${toolbarConfig.apiUrl}/api/review/${toolbarConfig.project}/notifications`, { method: 'POST', body: { muted: !state?.muted } }),
        onSuccess: async () => { announce(state?.muted ? 'Project emails unmuted' : 'Project emails muted'); await client.invalidateQueries({ queryKey: commentsQueryKeyPrefix }); }
    });
    if (!toolbarConfig.project || !state?.eligible || !state.member) return { error: follow.error ?? mute.error };
    return {
        follow: { following: state.following, pending: follow.isPending, onToggle: () => follow.mutate(!state.following) },
        mute: { muted: state.muted, pending: mute.isPending, onToggle: () => mute.mutate() },
        error: follow.error ?? mute.error
    };
}

/** Email about this thread for a guest after posting: Email me replies, once an address is confirmed. Never a comment requirement. */
export function ThreadNotifications({ comment }: { comment: CommentItem }) {
    const client = useQueryClient();
    const [email, setEmail] = useState('');
    const [editing, setEditing] = useState(false);
    const [verificationUrl, setVerificationUrl] = useState<string>();
    const state = comment.notifications;
    const follow = useMutation({
        mutationFn: async (following: boolean) => apiRequest<{ verificationUrl?: string }>(followUrl(comment), { method: 'POST', body: { following, ...(email ? { email } : {}) } }),
        onSuccess: async result => { setVerificationUrl(result?.verificationUrl); setEditing(false); await client.invalidateQueries({ queryKey: commentsQueryKeyPrefix }); }
    });
    if (!toolbarConfig.project || !state?.eligible || state.member) return null;
    return <div className="flex flex-col gap-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-3">
            <Button size="xs" variant="plain" className={quietButtonClassName} disabled={follow.isPending} onClick={() => {
                if (!state.following) setEditing(!editing);
                else follow.mutate(false);
            }}>{state.following ? 'Unfollow thread' : 'Email me replies'}</Button>
        </div>
        {editing && <form className="flex flex-col gap-2" onSubmit={event => { event.preventDefault(); follow.mutate(true); }}>
            <Input label="Email for replies" type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} />
            <p>Optional. Confirm your address to get replies and status changes. You can unsubscribe at any time.</p>
            <Button size="sm" type="submit" disabled={follow.isPending}>Send verification link</Button>
        </form>}
        {state.pending && <p role="status">Check your email to confirm reply notifications.</p>}
        {verificationUrl && <a href={verificationUrl} target="_blank" rel="noreferrer" className="underline">Open verification link</a>}
        <CommentsErrorMessage error={follow.error} />
    </div>;
}
