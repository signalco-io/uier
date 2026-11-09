import { getToolbarHost } from '../mount';

/** Whether the node is the toolbar's (its host and shadow root) or an inline thread slot's */
export function isToolbarNode(node: Node | null | undefined): boolean {
    const host = getToolbarHost();
    for (let current = node; current;) {
        const element = current instanceof Element ? current : current.parentElement;
        if (element && ((host && host.contains(element)) || element.closest('[data-uier-thread]'))) return true;
        // Out of a shadow root to its host: the toolbar's own, an inline thread's or the page's
        const root = current.getRootNode();
        current = root instanceof ShadowRoot ? root.host : null;
    }
    return false;
}

/**
 * The element a comment can be pinned to: the element itself, or for one inside the page's own
 * shadow roots, the outermost host in the document (stored anchors are document selectors).
 */
export function pageAnchorElement(element: Element | null | undefined): Element | undefined {
    let current = element ?? undefined;
    while (current) {
        const root = current.getRootNode();
        if (!(root instanceof ShadowRoot)) break;
        current = root.host;
    }
    return current?.isConnected && current !== document.documentElement && current !== document.body && current !== document.head
        && !isToolbarNode(current) ? current : undefined;
}

/** Whether the element takes up room on the page (a hidden one has no outline and no pin) */
export function isRendered(element: Element | undefined) {
    return Boolean(element?.isConnected && element.getClientRects().length > 0);
}

const elementKeys = new WeakMap<Element, number>();
let lastElementKey = 0;

/** The same number for the same element across checks, so a posted comment stays marked */
export function elementKey(element: Element) {
    let key = elementKeys.get(element);
    if (key === undefined) elementKeys.set(element, key = ++lastElementKey);
    return key;
}

const maxLabelLength = 80;

/** A short name of an element for the panels: `img#hero.logo`, at most one id and two classes */
export function elementLabel(element: Element): string {
    const tag = element.tagName.toLowerCase();
    const id = element.id && element.id.length <= 40 ? `#${element.id}` : '';
    const classes = [...element.classList].filter(name => name.length <= 30).slice(0, 2).map(name => `.${name}`).join('');
    const label = `${tag}${id}${classes}`;
    return label.length > maxLabelLength ? `${label.slice(0, maxLabelLength - 1)}…` : label;
}

/** Text in one line, without repeated white space, at most `max` characters */
export function oneLine(text: string | null | undefined, max = 120): string {
    const line = (text ?? '').replace(/\s+/g, ' ').trim();
    return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
