import { toolbarConfig } from './config';
import { getToolbarHost } from './mount';
import { toolbarAnchorPrefix, toolbarParts, toolbarPartsSelector, toolbarPartSegment, toolbarPinPrefix, type ToolbarPart } from './toolbarParts';
import type { CommentItemPosition } from './components/@types/Comments';

export { toolbarAnchorPrefix } from './toolbarParts';
/** Every part of the toolbar a comment can be pinned to on uier's own pages (docs/toolbar-review.md) */
export const toolbarReviewSurfaces = toolbarPartsSelector;

/**
 * uier's own pages: the page is served by the uier the toolbar talks to (its origin is the API's),
 * in production, previews and local development. A third-party page has an origin of its own and
 * cannot change it; a toolbar it points at an API on that origin does not talk to uier, and uier's
 * review API refuses toolbar anchors from a project's sites (`apps/web/src/lib/review/routes.ts`).
 */
export function canReviewToolbar() {
    try { return new URL(toolbarConfig.apiUrl, window.location.href).origin === window.location.origin; }
    catch { return false; }
}

/** The toolbar's shadow root, on uier's own pages only */
function reviewedRoot() {
    return canReviewToolbar() ? getToolbarHost()?.shadowRoot ?? null : null;
}

export function toolbarReviewTarget(node: Node | null | undefined): Element | null {
    const element = node instanceof Element ? node : node?.parentElement;
    const root = element?.getRootNode();
    if (!canReviewToolbar() || !(root instanceof ShadowRoot) || root.host !== getToolbarHost()
        || !element?.closest(toolbarReviewSurfaces)) return null;
    // An icon is part of its control, rather than a useful separate anchor.
    return element.closest('button,a,input,textarea,select') ?? element;
}

/** The id of a saved comment's pin: it names the pin when it opens the thread an anchor is in */
export function toolbarPinId(commentId: string) {
    return toolbarPinPrefix + commentId;
}

/** A saved comment's pin in the toolbar: never pinned to (what is under it is), but an opener */
function isToolbarPin(element: Element) {
    return element.getRootNode() === reviewedRoot() && element.id.startsWith(toolbarPinPrefix)
        && element.matches('button[data-uier-comment]');
}

function partOf(element: Element) {
    return element.matches(toolbarReviewSurfaces)
        ? (Object.keys(toolbarParts) as ToolbarPart[]).find(name => element.id === name || element.classList.contains(name))
        : undefined;
}

/**
 * The selector of a toolbar element through the shadow boundary: its part (`#uier-panel-inbox`,
 * `div.uier-thread`) and the way down from it, or a pin by its id. Not a toolbar element: `undefined`.
 */
export function toolbarAnchorSelector(element: Element): string | undefined {
    if (isToolbarPin(element)) return `${toolbarAnchorPrefix}#${CSS.escape(element.id)}`;
    if (!toolbarReviewTarget(element)) return undefined;
    const parts: string[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
        const part = partOf(node);
        if (part) {
            parts.unshift(toolbarPartSegment(part, node.tagName));
            return toolbarAnchorPrefix + parts.join('>');
        }
        if (!node.parentElement) break;
        const siblings = [...node.parentElement.children].filter(other => other.tagName === node!.tagName);
        parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`);
    }
    return undefined;
}

/** The expanded toolbar button that opened this layer: a popover's (`aria-controls`), the inbox's or the hint's */
function triggerOf(root: ShadowRoot, layer: Element) {
    if (!layer.id) return undefined;
    try {
        const trigger = root.querySelector(`[aria-expanded="true"][aria-controls~="${CSS.escape(layer.id)}"]`);
        return trigger && !layer.contains(trigger) ? trigger : undefined;
    } catch {
        return undefined;
    }
}

/**
 * The toolbar buttons that open the popover, menu or panel a reviewed part is in, outside in: for
 * nested ones (Copy in an open thread) the outermost first, which is on the page while they are all
 * closed (a thread's pin, a button of the pill), then each button in the layer the one before opens.
 * Saved as the anchor's opener and its `nested` openers (`layerAnchor.ts`).
 */
export function toolbarLayerOpeners(element: Element) {
    const root = reviewedRoot();
    if (!root || element.getRootNode() !== root) return [];
    const openers: Element[] = [];
    for (let node: Element | null = element; node && openers.length < 8; node = node.parentElement) {
        const trigger = triggerOf(root, node);
        if (trigger) openers.unshift(node = trigger);
    }
    return openers;
}

/** The outermost of {@link toolbarLayerOpeners} */
export function toolbarLayerOpener(element: Element): Element | undefined {
    return toolbarLayerOpeners(element)[0];
}

/** The open popovers, menus and panels a toolbar button opens, and those their own buttons open */
function layersOpenedBy(root: ShadowRoot, opener: Element) {
    const layers: Element[] = [];
    let triggers = [opener];
    for (let depth = 0; depth < 8 && triggers.length; depth++) {
        const next: Element[] = [];
        for (const trigger of triggers) {
            if (trigger.getAttribute('aria-expanded') !== 'true') continue;
            for (const id of (trigger.getAttribute('aria-controls') ?? '').split(/\s+/)) {
                const layer = id ? root.getElementById(id) : null;
                if (layer && !layers.includes(layer)) {
                    layers.push(layer);
                    next.push(...layer.querySelectorAll('[aria-expanded="true"][aria-controls]'));
                }
            }
        }
        triggers = next;
    }
    return layers;
}

/**
 * Stored selectors cross only our own shadow boundary, and only on uier's own pages. An anchor with
 * a toolbar opener is looked for only in what that opener opens: two threads can be open at once.
 */
export function queryAnchorElements(selector: string | undefined, opener?: string): Element[] {
    if (!selector) return [];
    try {
        if (selector.startsWith(toolbarAnchorPrefix)) {
            const root = reviewedRoot();
            if (!root) return [];
            const matches = [...root.querySelectorAll(selector.slice(toolbarAnchorPrefix.length))]
                .filter(element => toolbarReviewTarget(element) || isToolbarPin(element));
            const openers = opener?.startsWith(toolbarAnchorPrefix) ? queryAnchorElements(opener) : [];
            if (openers.length !== 1) return matches;
            const layers = layersOpenedBy(root, openers[0]!);
            return matches.filter(element => layers.some(layer => layer.contains(element)));
        }
        return [...document.querySelectorAll(selector)];
    } catch { return []; }
}

// Keeping the toolbar's popovers open while they are reviewed

/** On the Add comment button, and on the pin and popover of a comment on a toolbar part */
export const holdsLayersAttribute = 'data-uier-holds-layers';
let picking = 0;
let lastPress: EventTarget | undefined;

/** While an anchor is chosen (point mode): returns its end */
export function holdToolbarLayers() {
    picking++;
    return () => { picking--; };
}

/**
 * What the last press started on: a touch outside a popover closes it on its click, when the press's
 * own path is gone. Returns the cleanup.
 */
export function watchToolbarPresses() {
    if (!canReviewToolbar()) return () => {};
    const remember = (event: Event) => { lastPress = event.composedPath()[0]; };
    window.addEventListener('pointerdown', remember, { capture: true, passive: true });
    return () => window.removeEventListener('pointerdown', remember, { capture: true });
}

/**
 * On uier's own pages a toolbar popover or menu stays open when Add comment is pressed, while an
 * anchor is chosen, and while a comment on a toolbar part is written or read, so what is reviewed
 * stays on the page. Escape, its own controls and its button still close it.
 */
function keepToolbarLayerOpen(event: Event) {
    if (!canReviewToolbar()) return;
    const original = (event as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent;
    const target = original?.composedPath()[0] ?? lastPress;
    if (picking > 0 || (target instanceof Element && target.closest(`[${holdsLayersAttribute}]`))) event.preventDefault();
}

/**
 * Closes the toolbar's open popovers and menus a new comment is not in (`anchor`, its element), with
 * their buttons: held open while pointing, they close as the press outside them would have closed
 * them. Those the anchor is in stay open. The inbox and the hint are not popovers and stay.
 */
export function closeToolbarLayers(anchor: Element | null | undefined) {
    const root = reviewedRoot();
    if (!root) return;
    const opener = anchor ? toolbarLayerOpener(anchor) : undefined;
    const kept = opener ? layersOpenedBy(root, opener) : [];
    for (const trigger of root.querySelectorAll<HTMLElement>('[aria-expanded="true"][aria-haspopup="dialog"]')) {
        if (trigger !== opener && !kept.some(layer => layer.contains(trigger))) trigger.click();
    }
}

/**
 * A closing toolbar popover gives the focus back to its button, unless the focus has moved on in the
 * toolbar meanwhile: the text box of a new comment started on the page, which closed it.
 */
export function keepMovedFocus(event: Event) {
    const active = reviewedRoot()?.activeElement;
    if (active && !(event.target instanceof Node && event.target.contains(active))) event.preventDefault();
}

/**
 * Props of a reviewable toolbar popover, spread on the UI kit's `Popper` (it passes them to the
 * popover): the class that names it in anchors, {@link keepToolbarLayerOpen} and {@link keepMovedFocus}.
 */
export function toolbarSurface(part: ToolbarPart, className?: string) {
    return {
        className: className ? `${className} ${part}` : part,
        onInteractOutside: keepToolbarLayerOpen,
        onCloseAutoFocus: keepMovedFocus
    } as const;
}

/**
 * A nested opener (`layer.nested`): the one toolbar element `selector` matches in what the open
 * `outer` opener opens, else `undefined`
 */
export function nestedToolbarOpener(selector: string, outer: Element) {
    const root = reviewedRoot();
    if (!root || !selector.startsWith(toolbarAnchorPrefix)) return undefined;
    const layers = layersOpenedBy(root, outer);
    const matches = queryAnchorElements(selector).filter(element => layers.some(layer => layer.contains(element)));
    return matches.length === 1 ? matches[0] : undefined;
}

/**
 * A toolbar opener that can be pressed to show a comment: a collapsed toolbar button that opens a
 * popover, menu or panel (`aria-expanded="false"`). Saved selectors come from reviewers' browsers:
 * any other control (a menu's Delete) is never pressed for them.
 */
export function pressableToolbarOpener(element: Element | undefined) {
    return element instanceof HTMLElement && element.getRootNode() === reviewedRoot()
        && element.getAttribute('aria-expanded') === 'false' ? element : undefined;
}

/** Whether a comment is on a part of the toolbar, or in a popover a toolbar button opens */
export function isToolbarAnchor(position: CommentItemPosition) {
    if (position.type === 'page') return false;
    const selectors = position.type === 'point' ? [position.selector] : [position.startSelector, position.endSelector];
    return [...selectors, position.layer?.opener].some(selector => selector?.startsWith(toolbarAnchorPrefix));
}
