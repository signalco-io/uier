import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@signalco/ui-primitives/Button';
import { Input } from '@signalco/ui-primitives/Input';
import { toolbarConfig } from '../config';
import { apiRequest, currentReviewerRevision, required } from '../hooks/api';
import { CommentsErrorMessage } from './CommentsErrorMessage';

type State = { member: boolean; eligible: boolean; following: boolean; verified: boolean; pending: boolean; muted: boolean };

export function ThreadNotifications({ commentId, itemCount }: { commentId: string; itemCount: number }) {
    const client = useQueryClient();
    const [email, setEmail] = useState('');
    const [editing, setEditing] = useState(false);
    const [verificationUrl, setVerificationUrl] = useState<string>();
    const url = `${toolbarConfig.apiUrl}/api/review/${toolbarConfig.project}/comments/${encodeURIComponent(commentId)}/notifications`;
    const query = useQuery({ queryKey: ['thread-notifications', currentReviewerRevision(), commentId, itemCount], queryFn: async () => required(await apiRequest<State>(url)) });
    const follow = useMutation({
        mutationFn: async (following: boolean) => apiRequest<{ verificationUrl?: string }>(url, { method: 'POST', body: { following, ...(email ? { email } : {}) } }),
        onSuccess: async result => { setVerificationUrl(result?.verificationUrl); setEditing(false); await query.refetch(); }
    });
    const mute = useMutation({
        mutationFn: async () => apiRequest(`${toolbarConfig.apiUrl}/api/review/${toolbarConfig.project}/notifications`, { method: 'POST', body: { muted: !query.data?.muted } }),
        onSuccess: async () => { await client.invalidateQueries({ queryKey: ['thread-notifications'] }); }
    });
    const state = query.error ? undefined : query.data;
    if (!state?.eligible) return null;
    return <div className="flex flex-col gap-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
            <Button size="xs" variant="plain" className="pointer-coarse:min-h-11" disabled={follow.isPending} onClick={() => {
                if (!state.member && !state.following) setEditing(!editing);
                else follow.mutate(!state.following);
            }}>{state.following ? 'Unfollow thread' : state.member ? 'Follow thread' : 'Email me replies'}</Button>
            {state.member && <Button size="xs" variant="plain" className="pointer-coarse:min-h-11" disabled={mute.isPending} onClick={() => mute.mutate()}>
                {state.muted ? 'Unmute project emails' : 'Mute project emails'}
            </Button>}
        </div>
        {editing && <form className="flex flex-col gap-2" onSubmit={event => { event.preventDefault(); follow.mutate(true); }}>
            <Input label="Email for replies" type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} />
            <p>Optional. Confirm your address to get replies and status changes. You can unsubscribe at any time.</p>
            <Button size="sm" type="submit" disabled={follow.isPending}>Send verification link</Button>
        </form>}
        {state.pending && <p role="status">Check your email to confirm reply notifications.</p>}
        {verificationUrl && <a href={verificationUrl} target="_blank" rel="noreferrer" className="underline">Open verification link</a>}
        {state.member && <p>{state.muted ? 'Project emails are muted.' : 'Admins get new feedback. Members follow threads they post in. Replies and status changes are batched for 5 minutes.'}</p>}
        <CommentsErrorMessage error={follow.error ?? mute.error} />
    </div>;
}
