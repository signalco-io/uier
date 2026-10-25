import { useQuery } from '@tanstack/react-query';
import { toolbarConfig } from '../config';
import { apiRequest, projectViewerQueryKey } from './api';
import { useProjectViewer } from '../project/ProjectGate';

export type Participant = { id: string; name: string };
export function useParticipants(commentId?: string, active = true) {
    const { isMember } = useProjectViewer();
    const query = useQuery({
        queryKey: [...projectViewerQueryKey, 'participants', commentId ?? 'new'],
        queryFn: async () => await apiRequest<Participant[]>(`${toolbarConfig.apiUrl}/api/review/${toolbarConfig.project}/participants${commentId ? `?commentId=${encodeURIComponent(commentId)}` : ''}`) ?? [],
        enabled: Boolean(toolbarConfig.project && isMember && active),
        staleTime: 0,
        retry: false
    });
    // A disabled query can retain cached member data after sign-out or a permission error.
    return { ...query, data: isMember && active && !query.error ? query.data : undefined };
}
