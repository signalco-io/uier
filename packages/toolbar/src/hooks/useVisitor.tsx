import { UseMutationResult, UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toolbarConfig } from '../config';
import { apiRequest, commentsQueryKeyPrefix, projectViewerQueryKey, visitorQueryKey } from './api';
import { forgetProjectReviewer, getGuestName } from '../project/projectSession';

const visitorApiUrl = `${toolbarConfig.apiUrl}/api/visitor`;

/** `GET /api/visitor` */
export type Visitor = {
    /** Guest name (`Guest XXXX`), `null` before the visitor's first comment or reply */
    name: string | null;
    draftScope?: string;
    /** A project's member, signed in to uier (their account name) */
    member?: boolean;
};

async function getVisitor(): Promise<Visitor> {
    // A project's reviewer: a member (review token) or a guest with the name they gave
    if (toolbarConfig.project) {
        const info = await apiRequest<{ viewer?: { kind?: string; name?: string } }>(`${toolbarConfig.apiUrl}/api/review/${toolbarConfig.project}`);
        return info?.viewer?.kind === 'member'
            ? { name: info.viewer.name ?? null, member: true }
            : { name: getGuestName() ?? null };
    }

    const visitor = await apiRequest<Visitor>(visitorApiUrl);
    return { draftScope: visitor?.draftScope, name: typeof visitor?.name === 'string' ? visitor.name : null };
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
 * The anonymous visitor (the API's `uier_visitor` cookie): the profile shows the guest name,
 * signing out removes the cookie from this browser.
 */
export function useVisitor({ onSignedOut }: { onSignedOut?: () => void } = {}): {
    query: UseQueryResult<Visitor, Error>;
    signOut: UseMutationResult<void, Error, void, unknown>;
} {
    const client = useQueryClient();
    const query = useQuery({
        queryKey: visitorQueryKey,
        queryFn: getVisitor
    });

    const signOutMutation = useMutation({
        mutationFn: signOut,
        onSuccess: () => {
            onSignedOut?.();
            client.setQueryData<Visitor>(visitorQueryKey, { name: null });
            client.invalidateQueries({ queryKey: visitorQueryKey });
            // Nothing is "mine" anymore; a project asks again who the reviewer is
            client.invalidateQueries({ queryKey: commentsQueryKeyPrefix });
            client.invalidateQueries({ queryKey: projectViewerQueryKey });
        }
    });

    return { query, signOut: signOutMutation };
}
