import { createContext, useContext } from 'react';
import type { ToolbarMode } from '../config';
import type { ReviewLink } from '../review';

export type CommentsBootstrapperContextValue = {
    /** Container inside the toolbar's shadow root, used for popovers */
    rootElement?: HTMLElement;
    mode: ToolbarMode;
    /** The review this page is part of (`review` mode), `null` in showcase mode */
    review: ReviewLink | null;
    /** Canonical view key: pathname plus configured meaningful query/hash state. */
    path: string;
};

export const CommentsBootstrapperContext = createContext<CommentsBootstrapperContextValue>({
    rootElement: undefined,
    mode: 'review',
    review: null,
    path: '/'
});

export const ModalPortalContext = createContext<HTMLDialogElement | null>(null);

/** A native modal makes portals outside its subtree inert. Mount them above the dialog's scroll area. */
export function useToolbarPortalContainer(preferred?: HTMLElement | null) {
    const modal = useContext(ModalPortalContext);
    const { rootElement } = useContext(CommentsBootstrapperContext);
    return modal ?? preferred ?? rootElement;
}
