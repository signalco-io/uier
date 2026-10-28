import { getElementSelector } from '@signalco/js';
import { toolbarAnchorPrefix, toolbarReviewSurfaces, toolbarReviewTarget } from './toolbarReview';

/** Keep the existing compact selector when unique; otherwise disambiguate the chosen element. */
export function anchorSelector(element: Element | null | undefined): string {
    if (!element) return '';
    if (toolbarReviewTarget(element)) {
        const parts: string[] = [];
        for (let node: Element | null = element; node; node = node.parentElement) {
            if (node.matches(toolbarReviewSurfaces)) {
                parts.unshift(`#${node.id}`);
                return toolbarAnchorPrefix + parts.join('>');
            }
            const siblings = [...node.parentElement!.children].filter(other => other.tagName === node!.tagName);
            parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`);
        }
    }
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
