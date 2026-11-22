import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { activityQueryKey, apiRequest, commentsQueryKeyPrefix, currentReviewerRevision, projectViewerQueryKey, required } from '../hooks/api';
import { reviewApiUrl, type ReviewInfo } from './ProjectGate';
import type { ReviewSessionView } from './reviewSessionTypes';
export type { ReviewSessionComment, ReviewSessionTarget, ReviewSessionView } from './reviewSessionTypes';

type SessionCommand = { action: 'start' } | { action: 'resume'; id: string }
    | { action: 'discard'; id: string; draftId: string }
    | { action: 'edit'; id: string; draftId: string; title: string; summary: string }
    | { action: 'submit'; id: string; draftId: string; revision: number; idempotencyKey: string; title?: string; summary?: string };

export const reviewSessionDetailPrefix = ['review-session'] as const;
export const reviewSessionDetailKey = (id: string, scope: string | undefined) => [...reviewSessionDetailPrefix, id, scope] as const;
const sessionsUrl = () => `${reviewApiUrl}/review-sessions`;
const sessionUrl = (id: string) => `${sessionsUrl()}/${encodeURIComponent(id)}`;

export function loadReviewSession(id: string) {
    return apiRequest<ReviewSessionView>(sessionUrl(id)).then(required);
}

export async function refreshReviewSession(client: QueryClient) {
    await client.invalidateQueries({ queryKey: projectViewerQueryKey });
    void client.invalidateQueries({ queryKey: reviewSessionDetailPrefix });
}

export async function writeReviewSession(client: QueryClient, command: SessionCommand) {
    const viewerRevision = currentReviewerRevision();
    await client.cancelQueries({ queryKey: projectViewerQueryKey });
    if (viewerRevision !== currentReviewerRevision()) throw new Error('The viewer changed.');
    const value = await performSessionCommand(command);
    await client.cancelQueries({ queryKey: projectViewerQueryKey });
    if (viewerRevision !== currentReviewerRevision()) throw new Error('The viewer changed.');
    client.setQueryData<ReviewInfo>(projectViewerQueryKey, info => {
        if (!info) return info;
        if (command.action === 'edit') {
            // A late edit response must not bring a sent draft back into the toolbar.
            if (!value || info.reviewSession?.draftId !== command.draftId) return info;
            return { ...info, reviewSession: { ...info.reviewSession, title: value.title, summary: value.summary } };
        }
        if ((command.action === 'submit' || command.action === 'discard') && info.reviewSession && info.reviewSession.draftId !== command.draftId) return info;
        return { ...info, reviewSession: value?.state === 'open' || value?.state === 'discarding' ? value : undefined };
    });
    if (command.action === 'edit') return value;
    void client.invalidateQueries({ queryKey: commentsQueryKeyPrefix });
    void client.invalidateQueries({ queryKey: activityQueryKey });
    void client.invalidateQueries({ queryKey: reviewSessionDetailPrefix });
    return value;
}

function performSessionCommand(command: SessionCommand) {
    switch (command.action) {
        case 'start':
            return apiRequest<ReviewSessionView>(sessionsUrl(), { method: 'POST', body: {} });
        case 'resume':
            return apiRequest<ReviewSessionView>(`${sessionUrl(command.id)}/resume`, { method: 'POST', body: {} });
        case 'discard':
            return apiRequest<ReviewSessionView | null>(`${sessionUrl(command.id)}/held`, { method: 'DELETE', body: { draftId: command.draftId } });
        case 'edit':
            return apiRequest<ReviewSessionView>(sessionUrl(command.id), { method: 'PATCH', body: { draftId: command.draftId, title: command.title, summary: command.summary } });
        case 'submit':
            return apiRequest<ReviewSessionView>(`${sessionUrl(command.id)}/submit`, {
                method: 'POST',
                body: { draftId: command.draftId, revision: command.revision, idempotencyKey: command.idempotencyKey, title: command.title, summary: command.summary }
            });
    }
}

export function useReviewSessionCommand() {
    const client = useQueryClient();
    return useMutation({
        scope: { id: 'review-session' },
        mutationFn: (command: SessionCommand) => writeReviewSession(client, command),
        onError: () => { void refreshReviewSession(client); }
    });
}
