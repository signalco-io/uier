import { runtimeAdapters } from '../adapters';
import { createContext, PropsWithChildren, useContext, useMemo } from 'react';
import { CommentsBootstrapperContext } from '../components/CommentsBootstrapperContext';
import { useProjectViewer } from '../project/ProjectGate';
import { getVisitorToken } from '../project/projectSession';
import { toolbarConfig } from '../config';
import { createDraftStore } from './draftStorage';

export const newCommentDraftKey = 'new';
export const newRewriteDraftKey = 'new-rewrite';
/** A comment on a drawing (canvas mode): its own text, never another pin's draft */
export const newDrawingDraftKey = 'new-drawing';
export const feedbackDraftKey = 'feedback';

/**
 * A new comment's or rewrite's own draft (`new:<id>`, `new-rewrite:<id>`), so several can wait on a page, each
 * a draft pin and listed in the inbox. The drawing's stays one (`newDrawingDraftKey`: its drawing is in memory).
 */
export function newDraftKey(kind: 'comment' | 'rewrite') {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), value => value.toString(16).padStart(2, '0')).join('');
    return `${kind === 'rewrite' ? newRewriteDraftKey : newCommentDraftKey}:${id}`;
}

/** A page's new comment or rewrite draft: its own key, or the single one (`new`, `new-rewrite`) kept before there were several */
export function isPageDraftKey(key: string) {
    return /^new(?:-rewrite)?(?::[A-Za-z0-9_-]{1,64})?$/.test(key);
}

const DraftsContext = createContext<ReturnType<typeof createDraftStore> | undefined>(undefined);

/** Browser-local, seven-day drafts, scoped by API, project, authorized reviewer and canonical page. */
export function DraftsProvider({ children, page }: PropsWithChildren<{ page?: string }>) {
    const context = useContext(CommentsBootstrapperContext);
    const path = page ?? context.path;
    const { draftScope } = useProjectViewer();
    const drafts = useMemo(() => createDraftStore([toolbarConfig.apiUrl, toolbarConfig.project ?? 'public', draftScope ?? 'pending', runtimeAdapters() ? `${location.origin}${path}` : path], () => { if (!toolbarConfig.project) getVisitorToken(true); }, Boolean(draftScope)), [draftScope, path]);
    return <DraftsContext.Provider value={drafts}>{children}</DraftsContext.Provider>;
}

export function useDrafts() {
    const drafts = useContext(DraftsContext);
    if (!drafts) throw new Error('DraftsProvider is required');
    return drafts;
}
