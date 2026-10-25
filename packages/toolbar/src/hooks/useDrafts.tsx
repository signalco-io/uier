import { createContext, PropsWithChildren, useContext, useMemo } from 'react';
import { CommentsBootstrapperContext } from '../components/CommentsBootstrapperContext';
import { useProjectViewer } from '../project/ProjectGate';
import { getVisitorToken } from '../project/projectSession';
import { toolbarConfig } from '../config';
import { createDraftStore } from './draftStorage';

export const newCommentDraftKey = 'new';
export const newRewriteDraftKey = 'new-rewrite';
export const feedbackDraftKey = 'feedback';

const DraftsContext = createContext<ReturnType<typeof createDraftStore> | undefined>(undefined);

/** Browser-local, seven-day drafts, scoped by API, project, authorized reviewer and canonical page. */
export function DraftsProvider({ children, page }: PropsWithChildren<{ page?: string }>) {
    const context = useContext(CommentsBootstrapperContext);
    const path = page ?? context.path;
    const { draftScope } = useProjectViewer();
    const drafts = useMemo(() => createDraftStore([toolbarConfig.apiUrl, toolbarConfig.project ?? 'public', draftScope ?? 'pending', path], () => { if (!toolbarConfig.project) getVisitorToken(true); }, Boolean(draftScope)), [draftScope, path]);
    return <DraftsContext.Provider value={drafts}>{children}</DraftsContext.Provider>;
}

export function useDrafts() {
    const drafts = useContext(DraftsContext);
    if (!drafts) throw new Error('DraftsProvider is required');
    return drafts;
}
