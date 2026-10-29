'use client';

import { useMemo } from 'react';
import { CommentItemPosition, CommentPoint, CommentSelection } from '../components/@types/Comments';
import { getDomVersion, useLayoutVersion } from './useLayoutVersion';
import { queryAnchorElements } from '../toolbarReview';
import { getToolbarHost } from '../mount';

/** Selection text limit of the comments API; longer selections are stored cut to this length */
export const selectionTextMaxLength = 2000;

/**
 * `document.querySelector` that never throws. Stored positions come from anonymous visitors
 * (or from older toolbars), so a selector can be invalid; one bad comment must not break the
 * toolbar for everyone (see components/CommentErrorBoundary.tsx).
 */
export function safeQuerySelector(selector: string | undefined): Element | null {
    return queryAnchorElements(selector)[0] ?? null;
}

/** More than one selector match is never silently reduced to the first element. */
function selectorMatches(selector: string | undefined): Element[] {
    return queryAnchorElements(selector);
}

/** The element a comment is anchored to (the start of a text selection), if it is on the page */
export function resolveAnchorElement(position: CommentItemPosition | null | undefined): Element | null {
    if (!position) {
        return null;
    }

    switch (position.type) {
        case 'text': return safeQuerySelector(position.startSelector);
        case 'point': return safeQuerySelector(position.selector);
        default: return null;
    }
}

function textNodesOf(root: Node): Text[] {
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.parentElement?.closest('script,style,noscript,[data-uier-thread]')
            && !getToolbarHost()?.contains(node)) nodes.push(node as Text);
    }
    return nodes;
}

/**
 * Character offset of a point in a text node within all the text of `element` (its text nodes in
 * document order). Stored with text comments (`startType: 'text'`), so a selection that starts
 * after a link or bold text inside a paragraph is found again.
 */
export function textOffsetWithin(element: Element, node: Node, offset: number) {
    let total = 0;
    for (const text of textNodesOf(element)) {
        if (text === node) {
            return total + offset;
        }
        total += text.length;
    }
    return offset;
}

/** The text node and offset at a character offset within the element's text */
function pointAtTextOffset(element: Element, offset: number): { node: Node; offset: number } | null {
    const nodes = textNodesOf(element);
    let remaining = Number.isFinite(offset) ? Math.max(Math.trunc(offset), 0) : 0;
    for (const node of nodes) {
        if (remaining <= node.length) {
            return { node, offset: remaining };
        }
        remaining -= node.length;
    }
    const last = nodes.at(-1);
    return last ? { node: last, offset: last.length } : null;
}

/** Largest valid range offset in the node: characters in text nodes, children in elements */
function maxOffset(node: Node) {
    return node.nodeType === Node.TEXT_NODE
        || node.nodeType === Node.CDATA_SECTION_NODE
        || node.nodeType === Node.COMMENT_NODE
        ? (node as CharacterData).length
        : node.childNodes.length;
}

function clampOffset(node: Node, offset: number) {
    const value = Number.isFinite(offset) ? Math.trunc(offset) : 0;
    return Math.min(Math.max(value, 0), maxOffset(node));
}

function boundaryPoint(element: Element, type: CommentSelection['startType'], offset: number) {
    return type === 'text'
        ? pointAtTextOffset(element, offset)
        : { node: element, offset: clampOffset(element, offset) };
}

/** Text compared without any whitespace: the page's source and its rendered selection differ in it */
function withoutWhitespace(text: string) {
    return text.replace(/\s+/g, '');
}

/** Whether the range still holds the commented text (a cut, long selection: its start) */
function rangeHasText(range: Range, position: CommentSelection) {
    const expected = withoutWhitespace(position.text);
    const actual = withoutWhitespace(range.toString());
    return expected.length > 0 && (actual === expected
        || (position.text.length >= selectionTextMaxLength && actual.startsWith(expected)));
}

/** The range the stored selectors and offsets describe */
function rangeFromOffsets(position: CommentSelection): Range | null {
    if (selectorMatches(position.startSelector).length !== 1
        || (position.endSelector && selectorMatches(position.endSelector).length !== 1)) return null;
    const startElement = safeQuerySelector(position.startSelector);
    const endElement = position.endSelector?.length
        ? safeQuerySelector(position.endSelector)
        : startElement;
    if (!startElement || !endElement) {
        return null;
    }

    let start = boundaryPoint(startElement, position.startType, position.startOffset);
    let end = boundaryPoint(endElement, position.endType, position.endOffset);
    if (!start || !end) {
        return null;
    }

    // A selection made backwards (from its end to its start)
    const reversed = start.node === end.node
        ? start.offset > end.offset
        : Boolean(start.node.compareDocumentPosition(end.node) & Node.DOCUMENT_POSITION_PRECEDING);
    if (reversed) {
        [start, end] = [end, start];
    }

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
}

/** Shorter texts are not searched for: they would be found in too many places */
const searchTextMinLength = 3;

// Keep one entry per text node, not one object per character. Only the two matching boundary
// nodes need a whitespace-to-source offset conversion. All comments share this lazy page index.
let textIndex: { version: number; text: string; nodes: { node: Text; start: number; end: number }[] } | undefined;

function pageTextIndex() {
    const version = getDomVersion();
    if (textIndex?.version === version) return textIndex;
    const nodes: NonNullable<typeof textIndex>['nodes'] = [];
    const chunks: string[] = [];
    let length = 0;
    for (const node of textNodesOf(document.body)) {
        const text = withoutWhitespace(node.data);
        if (!text) continue;
        nodes.push({ node, start: length, end: length + text.length });
        chunks.push(text);
        length += text.length;
    }
    return textIndex = { version, text: chunks.join(''), nodes };
}

function indexedPoint(index: ReturnType<typeof pageTextIndex>, offset: number) {
    const entry = index.nodes.find(entry => offset < entry.end);
    if (!entry) return null;
    let remaining = offset - entry.start;
    for (let i = 0; i < entry.node.length; i++) {
        if (!/\s/.test(entry.node.data[i]!) && remaining-- === 0) return { node: entry.node, offset: i };
    }
    return null;
}

/** Finds one unambiguous match in the shared page index, ignoring whitespace. */
function findText(text: string): Range | 'ambiguous' | null {
    const needle = withoutWhitespace(text);
    if (needle.length < searchTextMinLength) {
        return null;
    }

    const page = pageTextIndex();
    const index = page.text.indexOf(needle);
    if (index < 0) return null;
    if (page.text.indexOf(needle, index + 1) >= 0) return 'ambiguous';
    const start = indexedPoint(page, index);
    const end = indexedPoint(page, index + needle.length - 1);
    if (!start || !end) {
        return null;
    }

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
    return range;
}

export type AnchorState = 'exact' | 'restored' | 'hidden' | 'missing' | 'ambiguous' | 'page';

const resolvedText = new WeakMap<CommentSelection, { version: number; result: { range: Range | null; state: AnchorState } }>();

/** Stored offsets are evidence. Text search is used only when it has one possible match. */
function resolveText(position: CommentSelection): { range: Range | null; state: AnchorState } {
    const version = getDomVersion();
    const cached = resolvedText.get(position);
    if (cached?.version === version) return cached.result;
    const fromOffsets = rangeFromOffsets(position);
    const exact = fromOffsets && rangeHasText(fromOffsets, position);
    const found = exact ? fromOffsets : findText(position.text);
    const result: { range: Range | null; state: AnchorState } = found === 'ambiguous'
        ? { range: null, state: 'ambiguous' }
        : { range: found, state: found ? exact ? 'exact' : 'restored' : 'missing' };
    resolvedText.set(position, { version, result });
    return result;
}

export function resolveTextRange(position: CommentSelection): Range | null {
    try { return resolveText(position).range; } catch { return null; }
}

/**
 * Whether the element is shown. Content of a closed `<details>` (and `content-visibility:
 * hidden`) still has layout boxes, but nothing should be pinned to it while it is hidden.
 */
function isShown(element: Element | null | undefined) {
    return Boolean(element) && (typeof element!.checkVisibility !== 'function' || element!.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
}

/** Line boxes of the range, when its text is shown */
function shownRangeRects(range: Range): DOMRect[] {
    const container = range.startContainer;
    const element = container instanceof Element ? container : container.parentElement;
    return isShown(element) ? [...range.getClientRects()] : [];
}

function pointRects(position: CommentPoint): DOMRect[] {
    const element = safeQuerySelector(position.selector);
    if (!element || !isShown(element)) {
        return [];
    }

    const rects = [...element.getClientRects()];
    const lastRect = lowestRect(rects);
    const xNormal = Number.isFinite(position.xNormal) ? Math.min(Math.max(position.xNormal, 0), 1) : 0.5;
    const yNormal = Number.isFinite(position.yNormal) ? Math.min(Math.max(position.yNormal, 0), 1) : 0.5;

    return [new DOMRect(
        (lastRect?.left ?? 0) + (lastRect?.width ?? 0) * xNormal,
        (lastRect?.top ?? 0) + (lastRect?.height ?? 0) * yNormal,
        1,
        1
    )];
}

/** Last lowest line box, without sorting/copying every rectangle on every layout frame. */
export function lowestRect(rects: DOMRect[]) {
    return rects.reduce<DOMRect | undefined>((last, rect) => !last || rect.bottom >= last.bottom ? rect : last, undefined);
}

/**
 * Viewport rectangles of a stored comment position: one 1x1 rect for a point comment, the line
 * boxes of the commented text for a text comment (none when the text is not on the page). Never
 * throws; an unresolvable position (and feedback about the whole page) has no rects.
 */
export function getCommentItemRects(position: CommentItemPosition | null | undefined): DOMRect[] {
    if (!position) {
        return [];
    }

    try {
        switch (position.type) {
            case 'text': {
                const range = resolveTextRange(position);
                return range ? shownRangeRects(range) : [];
            }
            case 'point': return selectorMatches(position.selector).length === 1 ? pointRects(position) : [];
            default: return [];
        }
    } catch (error) {
        console.warn('uier: Could not place a comment on this page', error);
        return [];
    }
}

export type CommentPlacement = { rects: DOMRect[]; state: AnchorState };

/** Missing or ambiguous anchors stay in the inbox, without an unrelated fallback pin. */
export function getCommentPlacement(position: CommentItemPosition | null | undefined): CommentPlacement {
    try {
        if (!position || position.type === 'page') return { rects: [], state: 'page' };
        if (position.type === 'point') {
            const matches = selectorMatches(position.selector);
            if (matches.length !== 1) return { rects: [], state: matches.length ? 'ambiguous' : 'missing' };
            const rects = pointRects(position);
            return { rects, state: rects.length ? 'exact' : 'hidden' };
        }
        const { range, state } = resolveText(position);
        const rects = range ? shownRangeRects(range).filter(rect => rect.width > 0 && rect.height > 0) : [];
        return { rects, state: range && !rects.length ? 'hidden' : state };
    } catch {
        return { rects: [], state: 'missing' };
    }
}

/** {@link getCommentItemRects}, measured again whenever the page may have moved */
export function useCommentItemRects(position: CommentItemPosition | null | undefined) {
    const layoutVersion = useLayoutVersion();
    return useMemo(() => getCommentItemRects(position), [position, layoutVersion]);
}

/** {@link getCommentPlacement}, measured again whenever the page may have moved */
export function useCommentPlacement(position: CommentItemPosition | null | undefined) {
    const layoutVersion = useLayoutVersion();
    return useMemo(() => getCommentPlacement(position), [position, layoutVersion]);
}
