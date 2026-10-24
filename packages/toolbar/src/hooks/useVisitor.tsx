import { UseMutationResult, UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toolbarConfig } from '../config';
import { apiRequest, commentsQueryKeyPrefix, visitorQueryKey } from './api';

const visitorApiUrl = `${toolbarConfig.apiUrl}/api/visitor`;

/** `GET /api/visitor` */
export type Visitor = {
    /** Guest name (`Guest XXXX`), `null` before the visitor's first comment or reply */
    name: string | null;
};

async function getVisitor(): Promise<Visitor> {
    const visitor = await apiRequest<Visitor>(visitorApiUrl);
    return { name: typeof visitor?.name === 'string' ? visitor.name : null };
}

async function signOut() {
    await apiRequest<void>(visitorApiUrl, { method: 'DELETE' });
}

/**
 * The anonymous visitor (the API's `uier_visitor` cookie): the profile shows the guest name,
 * signing out removes the cookie from this browser.
 */
export function useVisitor(): {
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
            client.setQueryData<Visitor>(visitorQueryKey, { name: null });
            // Nothing is "mine" anymore
            client.invalidateQueries({ queryKey: commentsQueryKeyPrefix });
        }
    });

    return { query, signOut: signOutMutation };
}
