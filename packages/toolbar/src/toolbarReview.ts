import { toolbarConfig } from './config';
import { getToolbarHost } from './mount';

export const toolbarAnchorPrefix = '#uier-toolbar>>>';
export const toolbarReviewSurfaces = '#uier-feedback-toolbar,#uier-panel-inbox';

/** The API's own pages include production, previews and local development; embeds stay excluded. */
export function canReviewToolbar() {
    try { return new URL(toolbarConfig.apiUrl, window.location.href).origin === window.location.origin; }
    catch { return false; }
}

export function toolbarReviewTarget(node: Node | null | undefined): Element | null {
    const element = node instanceof Element ? node : node?.parentElement;
    const root = element?.getRootNode();
    if (!canReviewToolbar() || !(root instanceof ShadowRoot) || root.host !== getToolbarHost()
        || !element?.closest(toolbarReviewSurfaces)) return null;
    // An icon is part of its control, rather than a useful separate anchor.
    return element.closest('button,a,input,textarea,select') ?? element;
}

/** Stored selectors cross only our own shadow boundary, and only on the API's own origin. */
export function queryAnchorElements(selector: string | undefined): Element[] {
    if (!selector) return [];
    try {
        if (selector.startsWith(toolbarAnchorPrefix)) {
            if (!canReviewToolbar()) return [];
            const root = getToolbarHost()?.shadowRoot;
            return [...root?.querySelectorAll(selector.slice(toolbarAnchorPrefix.length)) ?? []]
                .filter(element => toolbarReviewTarget(element));
        }
        return [...document.querySelectorAll(selector)];
    } catch { return []; }
}
