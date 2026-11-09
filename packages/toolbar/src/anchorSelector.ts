import { getElementSelector } from '@signalco/js';
import { toolbarAnchorSelector } from './toolbarReview';

/** Keep the existing compact selector when unique; otherwise disambiguate the chosen element. */
export function anchorSelector(element: Element | null | undefined): string {
    if (!element) return '';
    // On uier's own pages, a part of the toolbar through its shadow boundary
    const toolbar = toolbarAnchorSelector(element);
    if (toolbar) return toolbar;
    const compact = getElementSelector(element);
    try {
        const matches = document.querySelectorAll(compact);
        if (matches.length === 1 && matches[0] === element) return compact;
    } catch { /* Build a supported selector below. */ }
    const parts: string[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
        const siblings: Element[] = node.parentElement ? [...node.parentElement.children].filter(other => other.tagName === node!.tagName) : [node];
        parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`);
    }
    return parts.join('>');
}
