import { UseMutationResult, UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toolbarConfig } from '../config';
import { apiRequest, clearReviewerCache, commentsQueryKeyPrefix, projectViewerQueryKey, visitorQueryKey, pageVisitorQueryKey } from './api';
import { activityQueryKey } from './useComments';
import { forgetProjectReviewer, getGuestName } from '../project/projectSession';
import { usePagePath } from './usePagePath';

const visitorApiUrl = `${toolbarConfig.apiUrl}/api/visitor`;

/** `GET /api/visitor` */
export type Visitor = {
    /** Account or guest name (`Guest XXXX`), `null` before a guest's first comment or reply */
    name: string | null;
    draftScope?: string;
    privateAppFeedback?: boolean;
    /** A project's member, signed in to uier (their account name) */
    member?: boolean;
};

async function getVisitor(path: string): Promise<Visitor> {
    // A project's reviewer: a member (review token) or a guest with the name they gave
    if (toolbarConfig.project) {
        const info = await apiRequest<{ viewer?: { kind?: string; name?: string } }>(`${toolbarConfig.apiUrl}/api/review/${toolbarConfig.project}`);
        return info?.viewer?.kind === 'member'
            ? { name: info.viewer.name ?? null, member: true }
            : { name: getGuestName() ?? null };
    }

    const visitor = await apiRequest<Visitor>(`${visitorApiUrl}?path=${encodeURIComponent(path)}`);
    return { privateAppFeedback: visitor?.privateAppFeedback, draftScope: visitor?.draftScope, name: typeof visitor?.name === 'string' ? visitor.name : null, member: visitor?.member };
}

async function signOut() {
    if (toolbarConfig.project) {
        forgetProjectReviewer();
        return;
    }
    await apiRequest<void>(visitorApiUrl, { method: 'DELETE' });
    forgetProjectReviewer();
}

/**
 * The same-origin account or guest, or a project's reviewer. Account sign-out on uier's own
 * pages belongs to the app; guest sign-out removes the visitor cookie from this browser.
 */
export function useVisitor({ onSignedOut }: { onSignedOut?: () => void } = {}): {
    query: UseQueryResult<Visitor, Error>;
    signOut: UseMutationResult<void, Error, void, unknown>;
} {
    const client = useQueryClient();
    const path = usePagePath();
    const query = useQuery({
        queryKey: pageVisitorQueryKey(path),
        queryFn: () => getVisitor(path)
    });

    const signOutMutation = useMutation({
        mutationFn: signOut,
        onSuccess: async () => {
            onSignedOut?.();
            clearReviewerCache(client);
            client.invalidateQueries({ queryKey: activityQueryKey });
            client.setQueryData<Visitor>(visitorQueryKey, { name: null });
            client.invalidateQueries({ queryKey: visitorQueryKey });
            // Nothing is "mine" anymore; a project asks again who the reviewer is
            client.invalidateQueries({ queryKey: commentsQueryKeyPrefix });
            client.invalidateQueries({ queryKey: projectViewerQueryKey });
        }
    });

    return { query, signOut: signOutMutation };
}
