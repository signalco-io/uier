'use client';

import { useEffect, useState } from 'react';
import { arrayMax, orderBy } from '@signalco/js';
import { useWindowRect } from '@signalco/hooks/useWindowRect';
import { CommentItemPosition } from '../components/@types/Comments';

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

/** The element a comment is anchored to (the start of a text selection), if it is on the page */
export function resolveAnchorElement(position: CommentItemPosition | null | undefined): Element | null {
    if (!position) {
        return null;
    }

    return position.type === 'text'
        ? safeQuerySelector(position.startSelector)
        : safeQuerySelector(position.selector);
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

function pointRects(position: Extract<CommentItemPosition, { type: 'point' }>): DOMRect[] {
    const element = safeQuerySelector(position.selector);
    if (!element) {
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

function textRects(position: Extract<CommentItemPosition, { type: 'text' }>): DOMRect[] {
    const startElement = safeQuerySelector(position.startSelector);
    const endElement = position.endSelector?.length
        ? safeQuerySelector(position.endSelector)
        : startElement;

    if (!startElement || !endElement) {
        return [];
    }

    const startNode = position.startType === 'text'
        ? startElement.childNodes[0]
        : startElement;
    const endNode = position.endType === 'text'
        ? endElement.childNodes[0]
        : endElement;

    if (!startNode || !endNode) {
        return [];
    }

    // Fix reverse order of start/end elements
    const isReversed = (arrayMax([...startElement.getClientRects()], r => r?.top ?? 0) ?? 0) >
        (arrayMax([...endElement.getClientRects()], r => r?.top ?? 0) ?? 0);
    const firstNode = isReversed ? endNode : startNode;
    const lastNode = isReversed ? startNode : endNode;

    const swapOffsets = isReversed || (firstNode === lastNode && position.startOffset > position.endOffset);
    const startOffset = swapOffsets ? position.endOffset : position.startOffset;
    const endOffset = swapOffsets ? position.startOffset : position.endOffset;

    const range = document.createRange();
    range.setStart(firstNode, clampOffset(firstNode, startOffset));
    range.setEnd(lastNode, clampOffset(lastNode, endOffset));
    return [...range.getClientRects()];
}

/**
 * Viewport rectangles of a stored comment position: one 1x1 rect for a point comment, the line
 * boxes of the range for a text comment. Never throws; an unresolvable position has no rects.
 */
export function getCommentItemRects(position: CommentItemPosition | null | undefined): DOMRect[] {
    if (!position) {
        return [];
    }

    try {
        return position.type === 'text'
            ? textRects(position)
            : pointRects(position);
    } catch (error) {
        console.warn('uier: Could not place a comment on this page', error);
        return [];
    }
}

export function useCommentItemRects(commentSelection: CommentItemPosition | null | undefined) {
    const [selectionRects, setSelectionRects] = useState<DOMRect[]>([]);

    const windowRect = useWindowRect(window);

    useEffect(() => {
        setSelectionRects(getCommentItemRects(commentSelection));
    }, [commentSelection, windowRect]);

    return selectionRects;
}
