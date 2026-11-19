'use client';

import { useMemo } from 'react';
import { CommentAnchor, CommentItemPosition, CommentPoint, CommentSelection, isCommentArea } from '../components/@types/Comments';
import { getDomVersion, useLayoutVersion } from './useLayoutVersion';
import { nestedToolbarOpener, queryAnchorElements } from '../toolbarReview';
import { getToolbarHost } from '../mount';
import { isInActiveModal, layerOpenerIsExpanded } from '../modalLayer';

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

/** The point's element: a toolbar part only in the popover, menu or panel its saved opener opens */
function pointMatches(position: CommentPoint): Element[] {
    return queryAnchorElements(position.selector, position.layer?.opener);
}

/** The element a comment is anchored to (the start of a text selection), if it is on the page */
export function resolveAnchorElement(position: CommentItemPosition | null | undefined): Element | null {
    if (!position) {
        return null;
    }

    switch (position.type) {
        case 'text': return safeQuerySelector(position.startSelector);
        case 'point': return pointMatches(position)[0] ?? null;
        default: return null;
    }
}

/** Fresh, unique selector evidence for a preview. Closed-layer opener placement is not a target. */
export function resolvePreviewAnchor(position: CommentAnchor): { element: Element; end: Element } | null {
    const starts = position.type === 'point' ? pointMatches(position) : selectorMatches(position.startSelector);
    const ends = position.type === 'text' && position.endSelector ? selectorMatches(position.endSelector) : starts;
    if (starts.length !== 1 || ends.length !== 1 || !isShown(starts[0]) || !isShown(ends[0])) return null;
    return { element: starts[0]!, end: ends[0]! };
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
function pointAtTextOffset(element: Element, offset: number, strict: boolean): { node: Node; offset: number } | null {
    const nodes = textNodesOf(element);
    let remaining = Number.isFinite(offset) ? Math.max(Math.trunc(offset), 0) : 0;
    for (const node of nodes) {
        if (remaining <= node.length) {
            return { node, offset: remaining };
        }
        remaining -= node.length;
    }
    const last = nodes.at(-1);
    return last && !strict ? { node: last, offset: last.length } : null;
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

function boundaryPoint(element: Element, type: CommentSelection['startType'], offset: number, strict: boolean) {
    if (strict && (!Number.isSafeInteger(offset) || offset < 0 || (type === 'element' && offset > maxOffset(element)))) return null;
    return type === 'text'
        ? pointAtTextOffset(element, offset, strict)
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
function rangeFromElements(position: CommentSelection, startElement: Element, endElement: Element, strict: boolean): Range | null {
    const start = boundaryPoint(startElement, position.startType, position.startOffset, strict);
    const end = boundaryPoint(endElement, position.endType, position.endOffset, strict);
    if (!start || !end) {
        return null;
    }

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    // Compare the actual boundaries, including when one node contains the other.
    if (range.comparePoint(end.node, end.offset) < 0) {
        range.setStart(end.node, end.offset);
        range.setEnd(start.node, start.offset);
    } else {
        range.setEnd(end.node, end.offset);
    }
    return range;
}

function rangeFromOffsets(position: CommentSelection): Range | null {
    const starts = selectorMatches(position.startSelector);
    const ends = position.endSelector ? selectorMatches(position.endSelector) : starts;
    return starts.length === 1 && ends.length === 1 ? rangeFromElements(position, starts[0]!, ends[0]!, false) : null;
}

const collapsiblePreviewWhitespace = /[ \t\r\n]+/g;
const collapsibleHorizontalWhitespace = /[ \t]+/g;

function rangeWhitespaceRuns(range: Range, raw: string) {
    const root = range.commonAncestorContainer;
    const nodes = root instanceof Text ? [root] : textNodesOf(root).filter(node => range.intersectsNode(node));
    const runs: { start: number; end: number }[] = [];
    const modes = new Map<Element, string>();
    let offset = 0;
    for (const node of nodes) {
        const start = node === range.startContainer ? range.startOffset : 0;
        const end = node === range.endContainer ? range.endOffset : node.length;
        const text = node.data.slice(start, end);
        const parent = node.parentElement;
        if (parent && /[ \t\r\n]/.test(text)) {
            const mode = modes.get(parent) ?? getComputedStyle(parent).whiteSpaceCollapse;
            modes.set(parent, mode);
            const whitespace = mode === 'collapse' ? collapsiblePreviewWhitespace
                : mode === 'preserve-breaks' ? collapsibleHorizontalWhitespace : undefined;
            for (const match of whitespace ? text.matchAll(whitespace) : []) {
                const start = offset + match.index;
                const end = start + match[0].length;
                const last = runs.at(-1);
                if (last?.end === start) last.end = end;
                else runs.push({ start, end });
            }
        }
        offset += text.length;
    }
    return offset === raw.length ? runs : null;
}

type SourceOffsets = (start: number, end: number) => readonly [number, number];

function renderedSourceOffsets(raw: string, quote: string, runs: NonNullable<ReturnType<typeof rangeWhitespaceRuns>>): SourceOffsets | null {
    const characters: { start: number; end: number }[] = [];
    let source = 0;
    function consumeLiteral(end: number) {
        if (!quote.startsWith(raw.slice(source, end), characters.length)) return false;
        for (; source < end; source++) characters.push({ start: source, end: source + 1 });
        return true;
    }

    for (const [index, run] of runs.entries()) {
        if (!consumeLiteral(run.start)) return null;
        // Engines can retain one collapsed space at a selection edge or beside a preserved
        // line break. Check the following literal so an optional space cannot consume it.
        const optional = run.start === 0 || run.end === raw.length || raw[run.start - 1] === '\n' || raw[run.end] === '\n';
        const literal = raw.slice(run.end, runs[index + 1]?.start ?? raw.length);
        if (quote[characters.length] === ' ' && (!optional || quote.startsWith(' ' + literal, characters.length))) {
            characters.push(run);
        } else if (!optional) {
            return null;
        }
        source = run.end;
    }
    if (!consumeLiteral(raw.length) || characters.length !== quote.length || !characters.length) return null;

    return (start, end) => {
        // Use the visible characters on each side of an edit to leave any omitted whitespace
        // outside that span intact. Offsets and slices both use UTF-16.
        const first = characters[start]?.start ?? characters.at(-1)!.end;
        return [first, start === end ? first : characters[end - 1]!.end];
    };
}

/** Proposals require the complete saved selection at its offsets, without page-wide text recovery. */
export function resolvePreviewTextRange(position: CommentSelection, start: Element, end: Element) {
    const range = rangeFromElements(position, start, end, true);
    if (!range || !position.text.trim()) return null;

    const raw = range.toString();
    let runs: ReturnType<typeof rangeWhitespaceRuns> | undefined;
    const match = (quote: string): SourceOffsets | null => {
        if (raw === quote) return (start, end) => [start, end];
        if (runs === undefined) runs = rangeWhitespaceRuns(range, raw);
        return runs && renderedSourceOffsets(raw, quote, runs);
    };
    const saved = match(position.text);
    if (!saved) return null;
    return { range, offsetsFor: (quote: string) => quote === position.text ? saved : match(quote) };
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

/** `closed`: the anchor is in a menu, popover or dialog that is closed now, and its pin is on the opener */
export type AnchorState = 'exact' | 'restored' | 'hidden' | 'missing' | 'ambiguous' | 'page' | 'closed';

const resolvedText = new WeakMap<CommentSelection, { version: number; result: { range: Range | null; state: AnchorState } }>();
let previewText: { position: CommentSelection; range: () => Range | null; element: Element } | undefined;

/** Keep the selection pin on its edited range for the lifetime of a text preview. */
export function trackPreviewTextRange(position: CommentSelection, element: Element, range: () => Range | null) {
    const entry = { position, range, element };
    previewText = entry;
    return () => { if (previewText === entry) previewText = undefined; };
}

function previewPlacement(position: CommentSelection): CommentPlacement | undefined {
    const preview = previewText;
    if (!preview) return undefined;
    const original = preview.position;
    if (position.startSelector !== original.startSelector || position.endSelector !== original.endSelector
        || position.startType !== original.startType || position.endType !== original.endType
        || position.startOffset !== original.startOffset || position.endOffset !== original.endOffset
        || position.text !== original.text || !isShown(preview.element)) return undefined;
    const range = preview.range();
    if (!range) return undefined;
    const rects = shownRangeRects(range).filter(rect => rect.width > 0 && rect.height > 0);
    if (rects.length) return { rects, state: 'exact' };
    // An empty replacement has no line box of its own. Keep its pin at the edited location.
    const caret = range.getClientRects()[0] ?? preview.element.getClientRects()[0];
    return caret ? { rects: [new DOMRect(caret.x, caret.y, 1, Math.max(caret.height, 1))], state: 'exact' } : undefined;
}

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
 * hidden`) still has layout boxes, but nothing should be pinned to it while it is hidden. While a
 * modal dialog is open the rest of the page is inert behind its backdrop: only the modal has pins.
 */
function isShown(element: Element | null | undefined) {
    return Boolean(element) && isInActiveModal(element!)
        && (typeof element!.checkVisibility !== 'function' || element!.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
}

/** Line boxes of the range, when its text is shown */
function shownRangeRects(range: Range): DOMRect[] {
    const container = range.startContainer;
    const element = container instanceof Element ? container : container.parentElement;
    return isShown(element) ? [...range.getClientRects()] : [];
}

/** A stored fraction of a box, clamped to the box (positions come from anonymous visitors) */
function fraction(value: number | undefined, fallback: number) {
    return Number.isFinite(value) ? Math.min(Math.max(value!, 0), 1) : fallback;
}

function pointRects(position: CommentPoint): DOMRect[] {
    const element = pointMatches(position)[0];
    if (!element || !isShown(element)) {
        return [];
    }

    // An area is a part of the element's whole box, as it was measured when the area was drawn
    if (isCommentArea(position)) {
        const box = element.getBoundingClientRect();
        const x = fraction(position.xNormal, 0);
        const y = fraction(position.yNormal, 0);
        return [new DOMRect(
            box.left + box.width * x,
            box.top + box.height * y,
            box.width * Math.min(fraction(position.widthNormal, 1), 1 - x),
            box.height * Math.min(fraction(position.heightNormal, 1), 1 - y)
        )];
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
 * Viewport rectangles of a stored comment position: one 1x1 rect for a point comment, the area
 * for an area comment, the line boxes of the commented text for a text comment (none when the
 * text is not on the page). Never throws; an unresolvable position (and feedback about the whole
 * page) has no rects.
 */
export function getCommentItemRects(position: CommentItemPosition | null | undefined): DOMRect[] {
    if (!position) {
        return [];
    }

    try {
        switch (position.type) {
            case 'text': {
                const preview = previewPlacement(position);
                if (preview) return preview.rects;
                const range = resolveTextRange(position);
                return range ? shownRangeRects(range) : [];
            }
            case 'point': return pointMatches(position).length === 1 ? pointRects(position) : [];
            default: return [];
        }
    } catch (error) {
        console.warn('uier: Could not place a comment on this page', error);
        return [];
    }
}

/**
 * `opener`: of a `closed` placement, the element it is on; `depth`, which of the saved openers that
 * is (0 the outermost, then the `nested` toolbar openers in the layers they open)
 */
export type CommentPlacement = { rects: DOMRect[]; state: AnchorState; opener?: Element; depth?: number };

const isExpanded = layerOpenerIsExpanded;

/**
 * An anchor that is not shown (hidden or missing) in a menu, popover or dialog that is closed now:
 * placed on the element that opens it, while that element is shown and not expanded (when it is,
 * the layer is open and the anchor is really gone). Of nested toolbar layers, the first closed one
 * from the outside in: the thread's pin while the thread is closed, then Copy in the open thread.
 */
function closedLayerPlacement(position: CommentAnchor): CommentPlacement | undefined {
    const matches = selectorMatches(position.layer?.opener);
    let opener = matches.length === 1 ? matches[0] : undefined;
    let depth = 0;
    for (const selector of position.layer?.nested ?? []) {
        if (!opener || !isExpanded(opener)) break;
        opener = nestedToolbarOpener(selector, opener);
        depth++;
    }
    if (!opener || !isShown(opener) || isExpanded(opener)) return undefined;
    return { rects: [opener.getBoundingClientRect()], state: 'closed', opener, depth };
}

/**
 * Missing or ambiguous anchors stay in the inbox, without an unrelated fallback pin. The one
 * fallback is the opener of the closed menu, popover or dialog that the anchor was saved in.
 */
export function getCommentPlacement(position: CommentItemPosition | null | undefined): CommentPlacement {
    try {
        if (!position || position.type === 'page') return { rects: [], state: 'page' };
        if (position.type === 'point') {
            const matches = pointMatches(position);
            if (matches.length > 1) return { rects: [], state: 'ambiguous' };
            const rects = matches.length ? pointRects(position) : [];
            return rects.length ? { rects, state: 'exact' }
                : closedLayerPlacement(position) ?? { rects, state: matches.length ? 'hidden' : 'missing' };
        }
        const preview = previewPlacement(position);
        if (preview) return preview;
        const { range, state } = resolveText(position);
        const rects = range ? shownRangeRects(range).filter(rect => rect.width > 0 && rect.height > 0) : [];
        const shownState = range && !rects.length ? 'hidden' : state;
        return !rects.length && (shownState === 'hidden' || shownState === 'missing')
            ? closedLayerPlacement(position) ?? { rects, state: shownState }
            : { rects, state: shownState };
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
