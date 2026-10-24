import { createContext } from 'react';
import type { ToolbarMode } from '../config';

export type CommentsBootstrapperContextValue = {
    /** Container inside the toolbar's shadow root, used for popovers */
    rootElement?: HTMLElement;
    mode: ToolbarMode;
    /** Normalized path of the current page (see hooks/usePagePath.tsx) */
    path: string;
};

export const CommentsBootstrapperContext = createContext<CommentsBootstrapperContextValue>({
    rootElement: undefined,
    mode: 'review',
    path: '/'
});
