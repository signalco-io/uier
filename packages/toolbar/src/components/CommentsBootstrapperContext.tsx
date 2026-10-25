import { createContext } from 'react';
import type { ToolbarMode } from '../config';
import type { ReviewSession } from '../review';

export type CommentsBootstrapperContextValue = {
    /** Container inside the toolbar's shadow root, used for popovers */
    rootElement?: HTMLElement;
    mode: ToolbarMode;
    /** The review this page is part of (`review` mode), `null` in showcase mode */
    review: ReviewSession | null;
    /** Canonical view key: pathname plus configured meaningful query/hash state. */
    path: string;
};

export const CommentsBootstrapperContext = createContext<CommentsBootstrapperContextValue>({
    rootElement: undefined,
    mode: 'review',
    review: null,
    path: '/'
});
