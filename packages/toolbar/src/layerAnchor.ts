import { anchorSelector } from './anchorSelector';
import { layerOpener } from './modalLayer';
import { resolveAnchorElement } from './hooks/useCommentItemRects';
import { toolbarReviewTarget } from './toolbarReview';
import type { CommentAnchor } from './components/@types/Comments';

/** As the API takes them: the selector length and a short name with a visible character */
const maxSelectorLength = 1024;
const maxLabelLength = 120;
const visibleCharacter = /[^\p{White_Space}\p{Cc}\p{Cf}ᅟᅠㅤﾠ⠀]/u;

/** The opener's name as a reviewer reads it: its label, else its text */
function nameOf(element: Element) {
    const labelledBy = element.getAttribute('aria-labelledby')?.split(/\s+/)
        .map(id => (id && document.getElementById(id)?.textContent) || '').join(' ');
    const text = (element.getAttribute('aria-label') || labelledBy || element.textContent || element.getAttribute('title') || '')
        .replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim();
    let name = '';
    for (const character of text) {
        if (name.length + character.length > maxLabelLength) break;
        name += character;
    }
    return visibleCharacter.test(name) ? name.trim() : undefined;
}

/**
 * The anchor with the menu, popover or dialog it is in, when the page opens it with an element:
 * while it is closed, its comments show on that element. Taken when the anchor is chosen, while the
 * layer is open; an anchor elsewhere (or on the toolbar) is returned without one.
 */
export function withLayer<T extends CommentAnchor>(anchor: T): T {
    const { layer: _previous, ...position } = anchor;
    try {
        const element = resolveAnchorElement(anchor);
        if (!element || toolbarReviewTarget(element)) return position as T;
        const opener = layerOpener(element);
        const selector = opener && anchorSelector(opener);
        if (!opener || !selector || selector.length > maxSelectorLength) return position as T;
        const label = nameOf(opener);
        return { ...position, layer: { opener: selector, ...(label ? { label } : {}) } } as T;
    } catch {
        return position as T;
    }
}
