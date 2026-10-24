'use client';

import { useMemo } from 'react';
import { orderBy } from '@signalco/js';
import { CommentItemPosition, CommentPoint, CommentSelection } from '../components/@types/Comments';
import { useLayoutVersion } from './useLayoutVersion';

/** Selection text limit of the comments API; longer selections are stored cut to this length */
export const selectionTextMaxLength = 2000;

/**
 * `document.querySelector` that never throws. Stored positions come from anonymous visitors
 * (or from older toolbars), so a selector can be invalid; one bad comment must not break the
 * toolbar for everyone (see components/CommentErrorBoundary.tsx).
 */
export function safeQuerySelector(selector: string | undefined): Element | null {
    if (!selector?.length) {
        return null;
    }

    try {
        return document.querySelector(selector);
    } catch {
        return null;
    }
}

/**
 * The element of a `>` selector chain (as the toolbar creates them), or its closest ancestor in
 * the chain that is still on the page. Never the page's `html` or `body`.
 */
function closestExistingElement(selector: string | undefined): Element | null {
    if (!selector?.length) {
        return null;
    }

    // `>` that is not escaped (identifiers escape special characters with a backslash)
    const parts = selector.split(/(?<!\\)>/);
    for (let count = parts.length; count > 0; count--) {
        const element = safeQuerySelector(parts.slice(0, count).join('>'));
        if (element && element !== document.documentElement && element !== document.body) {
            return element;
        }
    }
    return null;
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
        nodes.push(node as Text);
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

/** Finds the text in `root` (ignoring whitespace), e.g. after the page changed around it */
function findText(root: Element, text: string): Range | null {
    const needle = withoutWhitespace(text);
    if (needle.length < searchTextMinLength) {
        return null;
    }

    let haystack = '';
    const points: { node: Text; offset: number }[] = [];
    for (const node of textNodesOf(root)) {
        const data = node.data;
        for (let i = 0; i < data.length; i++) {
            const char = data[i]!;
            if (!/\s/.test(char)) {
                haystack += char;
                points.push({ node, offset: i });
            }
        }
    }

    const index = haystack.indexOf(needle);
    const start = points[index];
    const end = points[index + needle.length - 1];
    if (index < 0 || !start || !end) {
        return null;
    }

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
    return range;
}

/** Searches the element of the selection first, then its ancestors up to the whole page */
function searchText(position: CommentSelection): Range | null {
    let scope: Element | null = closestExistingElement(position.startSelector) ?? document.body;
    while (scope) {
        const range = findText(scope, position.text);
        if (range) {
            return range;
        }
        scope = scope.parentElement;
    }
    return null;
}

// Resolved ranges per stored position (live ranges follow the page as it changes); a miss is
// searched again after a while, for content that loads later
const resolvedRanges = new WeakMap<CommentSelection, { range: Range | null; at: number }>();
const missRetryMs = 1000;

/**
 * The page range of a text comment: where its selectors and offsets point, or where its text is
 * found if the page changed. `null` when the text is not on the page (anymore).
 */
export function resolveTextRange(position: CommentSelection): Range | null {
    const cached = resolvedRanges.get(position);
    if (cached?.range && cached.range.startContainer.isConnected && rangeHasText(cached.range, position)) {
        return cached.range;
    }
    if (cached && !cached.range && Date.now() - cached.at < missRetryMs) {
        return null;
    }

    const fromOffsets = rangeFromOffsets(position);
    const range = fromOffsets && rangeHasText(fromOffsets, position)
        ? fromOffsets
        : searchText(position);
    resolvedRanges.set(position, { range, at: Date.now() });
    return range;
}

/**
 * Whether the element is shown. Content of a closed `<details>` (and `content-visibility:
 * hidden`) still has layout boxes, but nothing should be pinned to it while it is hidden.
 */
function isShown(element: Element | null | undefined) {
    return Boolean(element) && (typeof element!.checkVisibility !== 'function' || element!.checkVisibility());
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
    const lastRect = orderBy(rects, r => r.bottom).at(-1);
    const xNormal = Number.isFinite(position.xNormal) ? Math.min(Math.max(position.xNormal, 0), 1) : 0.5;
    const yNormal = Number.isFinite(position.yNormal) ? Math.min(Math.max(position.yNormal, 0), 1) : 0.5;

    return [new DOMRect(
        (lastRect?.left ?? 0) + (lastRect?.width ?? 0) * xNormal,
        (lastRect?.top ?? 0) + (lastRect?.height ?? 0) * yNormal,
        1,
        1
    )];
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
            case 'point': return pointRects(position);
            default: return [];
        }
    } catch (error) {
        console.warn('uier: Could not place a comment on this page', error);
        return [];
    }
}

export type CommentPlacement = {
    /** Where the pin goes: it sits below and right of the last rect */
    rects: DOMRect[];
    /**
     * The commented text is not on the page anymore: the pin marks the closest element that is
     * (the selection's element or one of its ancestors), so the thread stays reachable
     */
    textMissing: boolean;
};

/**
 * Where a comment's pin goes. Text that is on the page but not shown (e.g. in a closed
 * `<details>`) has no pin, like an element that is hidden on this device.
 */
export function getCommentPlacement(position: CommentItemPosition | null | undefined): CommentPlacement {
    if (position?.type !== 'text') {
        return { rects: getCommentItemRects(position), textMissing: false };
    }

    try {
        const range = resolveTextRange(position);
        if (range) {
            return { rects: shownRangeRects(range), textMissing: false };
        }

        const element = closestExistingElement(position.startSelector);
        const rect = isShown(element) ? element?.getBoundingClientRect() : undefined;
        return {
            // Inside the element's top left corner
            rects: rect && (rect.width || rect.height) ? [new DOMRect(rect.left, rect.top, 1, 1)] : [],
            textMissing: true
        };
    } catch (error) {
        console.warn('uier: Could not place a comment on this page', error);
        return { rects: [], textMissing: false };
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
