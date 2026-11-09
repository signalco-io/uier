import { anchorSelector } from './anchorSelector';
import { layerOpener } from './modalLayer';
import { resolveAnchorElement } from './hooks/useCommentItemRects';
import { toolbarAnchorPrefix, toolbarLayerOpeners, toolbarReviewTarget } from './toolbarReview';
import type { CommentAnchor } from './components/@types/Comments';

/** As the API takes them: the selector length and a short name with a visible character */
const maxSelectorLength = 1024;
const maxLabelLength = 120;
/** As the API takes them: the openers of nested toolbar layers inside the outermost one */
const maxNestedOpeners = 7;
const visibleCharacter = /[^\p{White_Space}\p{Cc}\p{Cf}ᅟᅠㅤﾠ⠀]/u;

/** The name as the API takes it: plain text, at most 120 characters, with a visible one */
function shortName(value: string) {
    const text = value.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim();
    let name = '';
    for (const character of text) {
        if (name.length + character.length > maxLabelLength) break;
        name += character;
    }
    return visibleCharacter.test(name) ? name.trim() : undefined;
}

/** The opener's name as a reviewer reads it: its label, else its text */
function nameOf(element: Element) {
    const labelledBy = element.getAttribute('aria-labelledby')?.split(/\s+/)
        .map(id => (id && document.getElementById(id)?.textContent) || '').join(' ');
    return shortName(element.getAttribute('aria-label') || labelledBy || element.textContent || element.getAttribute('title') || '');
}

/** A toolbar button's name without its count or state: "Inbox" for "Inbox, 2 unread threads", "Comment #6" for a pin */
function toolbarNameOf(element: Element) {
    return shortName(element.getAttribute('aria-label')?.split(',')[0] ?? '');
}

/**
 * The anchor with the menu, popover or dialog it is in, when an element opens it: while it is
 * closed, its comments show on that element. Taken when the anchor is chosen, while the layer is
 * open; an anchor elsewhere is returned without one. On uier's own pages the toolbar's own popovers,
 * menus and the inbox count too: their opener is a button of the pill or a thread's pin, and a
 * toolbar layer inside another (Copy in a thread) saves the buttons that open the inner ones too.
 * `element` is the chosen element, when it is known (else the anchor's).
 */
export function withLayer<T extends CommentAnchor>(anchor: T, element?: Element | null): T {
    const { layer: _previous, ...position } = anchor;
    try {
        const anchored = element ?? resolveAnchorElement(position as T);
        if (!anchored) return position as T;
        const toolbar = Boolean(toolbarReviewTarget(anchored));
        const [opener, ...inner] = toolbar ? toolbarLayerOpeners(anchored) : [layerOpener(anchored)];
        const selector = opener && anchorSelector(opener);
        if (!opener || !selector || selector.length > maxSelectorLength) return position as T;
        const label = toolbar ? toolbarNameOf(opener) : nameOf(opener);
        // Without every inner opener only the outermost is kept: the comment shows once its layers are open
        const nested = inner.map(element => anchorSelector(element));
        const keepNested = nested.length > 0 && nested.length <= maxNestedOpeners
            && nested.every(inner => inner.startsWith(toolbarAnchorPrefix) && inner.length <= maxSelectorLength);
        return { ...position, layer: { opener: selector, ...(label ? { label } : {}), ...(keepNested ? { nested } : {}) } } as T;
    } catch {
        return position as T;
    }
}
