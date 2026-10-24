import { createContext, PropsWithChildren, useContext, useRef } from 'react';

/** Key of the text of a comment that is not saved yet; replies use the comment's id */
export const newCommentDraftKey = 'new';

/** Key of the suggested text of a rewrite that is not posted yet (it starts as the selected text) */
export const newRewriteDraftKey = 'new-rewrite';

/** Key of the text of feedback or a bug report that is not sent yet */
export const feedbackDraftKey = 'feedback';

type Drafts = Map<string, string>;

const DraftsContext = createContext<Drafts>(new Map());

/**
 * Unsent comment and reply texts, kept while the toolbar is mounted, so text is not lost when a
 * popover closes (outside click, Escape) and comes back when it opens again.
 */
export function DraftsProvider({ children }: PropsWithChildren) {
    const drafts = useRef<Drafts>(new Map());
    return (
        <DraftsContext.Provider value={drafts.current}>
            {children}
        </DraftsContext.Provider>
    );
}

export function useDrafts() {
    return useContext(DraftsContext);
}
