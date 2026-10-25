import { createContext, PropsWithChildren, useContext, useMemo, useRef } from 'react';
import { CommentsBootstrapperContext } from '../components/CommentsBootstrapperContext';

/** Key of the text of a comment that is not saved yet; replies use the comment's id */
export const newCommentDraftKey = 'new';

/** Key of the suggested text of a rewrite that is not posted yet (it starts as the selected text) */
export const newRewriteDraftKey = 'new-rewrite';

/** Key of the text of feedback or a bug report that is not sent yet */
export const feedbackDraftKey = 'feedback';

type Drafts = { get: (key: string) => string | undefined; set: (key: string, value: string) => void; delete: (key: string) => void };

const DraftsContext = createContext<Drafts>(new Map());

/**
 * Unsent comment and reply texts, kept while the toolbar is mounted, so text is not lost when a
 * popover closes (outside click, Escape) and comes back when it opens again.
 */
export function DraftsProvider({ children }: PropsWithChildren) {
    const { path } = useContext(CommentsBootstrapperContext);
    const values = useRef(new Map<string, string>());
    const drafts = useMemo<Drafts>(() => {
        const scoped = (key: string) => JSON.stringify([path, key]);
        return {
            get: key => values.current.get(scoped(key)),
            set: (key, value) => { values.current.set(scoped(key), value); },
            delete: key => { values.current.delete(scoped(key)); }
        };
    }, [path]);
    return (
        <DraftsContext.Provider value={drafts}>
            {children}
        </DraftsContext.Provider>
    );
}

export function useDrafts() {
    return useContext(DraftsContext);
}
