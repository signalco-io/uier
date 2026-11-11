/**
 * Where a drawing is on the page while it is drawn, and the comment it becomes (docs/canvas-mode.md).
 *
 * While drawing, shapes are kept in the coordinates of the content of one scroll container, the
 * session's frame: the page (`null`), or the scrolled element the first shape was drawn over (an app
 * whose main column scrolls). They stay on what they were drawn over as it scrolls. When it is done,
 * the drawing's box becomes the comment's area, anchored like a dragged area on the innermost element
 * that holds it, and the shapes are kept from that area's top-left corner.
 */
import { anchorSelector } from '../anchorSelector';
import { getToolbarHost } from '../mount';
import { activeModalDialog, isInActiveModal } from '../modalLayer';
import { drawingVersion, parseDrawing, type CommentDrawing, type DrawingShape } from '../drawing';
import type { CommentPoint } from '../components/@types/Comments';
import { moveShape, roundShape, shapeBounds, unionBounds, type Bounds, type Point } from './geometry';

/** Room around the shapes in the comment's area */
const areaPadding = 8;

/** The scrolled element shapes are drawn on, or `null` for the page */
export type CanvasFrame = Element | null;

/** Where the frame's content starts in the window: shapes are at that offset from (0, 0) */
export function frameOffset(frame: CanvasFrame): Point {
    if (!frame?.isConnected) return { x: -window.scrollX, y: -window.scrollY };
    const rect = frame.getBoundingClientRect();
    return { x: rect.left + frame.clientLeft - frame.scrollLeft, y: rect.top + frame.clientTop - frame.scrollTop };
}

/** The page's elements at a point of the window, without the toolbar */
function pageElementsAt(x: number, y: number) {
    const host = getToolbarHost();
    return document.elementsFromPoint(x, y).filter(element => element !== host && isInActiveModal(element));
}

function parentOf(element: Element) {
    return element.parentElement ?? (element.parentNode instanceof ShadowRoot ? element.parentNode.host : null);
}

function scrolls(element: Element, axis: 'x' | 'y', delta = 0) {
    const style = getComputedStyle(element);
    const overflow = axis === 'y' ? style.overflowY : style.overflowX;
    if (!/(auto|scroll|overlay)/.test(overflow)) return false;
    const room = axis === 'y' ? element.scrollHeight - element.clientHeight : element.scrollWidth - element.clientWidth;
    if (room <= 1) return false;
    if (!delta) return true;
    const position = axis === 'y' ? element.scrollTop : element.scrollLeft;
    return delta < 0 ? position > 0 : position < room - 1;
}

function isPageScroller(element: Element) {
    return element === document.scrollingElement || element === document.documentElement || element === document.body;
}

/** The scrolled element under the point that holds the page's content there, else the page */
export function frameAt(x: number, y: number): CanvasFrame {
    for (let element: Element | null = pageElementsAt(x, y)[0] ?? null; element; element = parentOf(element)) {
        if (isPageScroller(element)) return null;
        if (scrolls(element, 'y') || scrolls(element, 'x')) return element;
    }
    return null;
}

/**
 * The element a wheel or two-finger move over the point scrolls: the first one under it that can
 * still scroll that way, `null` for the page
 */
export function scrollTargetAt(x: number, y: number, dx: number, dy: number): CanvasFrame {
    for (let element: Element | null = pageElementsAt(x, y)[0] ?? null; element; element = parentOf(element)) {
        if (isPageScroller(element)) return null;
        if ((dy && scrolls(element, 'y', dy)) || (dx && scrolls(element, 'x', dx))) return element;
    }
    return null;
}

export function scrollFrameBy(target: CanvasFrame, dx: number, dy: number) {
    if (target) target.scrollBy({ left: dx, top: dy, behavior: 'instant' });
    else window.scrollBy({ left: dx, top: dy, behavior: 'instant' });
}

/** The shapes' box, with room around them, in the frame's coordinates */
export function shapesBox(shapes: readonly DrawingShape[]): Bounds | undefined {
    const bounds = unionBounds(shapes.map(shapeBounds));
    return bounds && {
        x: bounds.x - areaPadding,
        y: bounds.y - areaPadding,
        width: bounds.width + areaPadding * 2,
        height: bounds.height + areaPadding * 2
    };
}

/** The innermost page element whose box holds the whole area (the window rectangle), found up from a point of it in the window */
function elementAround(area: DOMRect) {
    const x = Math.min(Math.max(area.left + area.width / 2, area.left + 1, 1), Math.min(area.right - 1, window.innerWidth - 1));
    const y = Math.min(Math.max(area.top + area.height / 2, area.top + 1, 1), Math.min(area.bottom - 1, window.innerHeight - 1));
    for (let element: Element | null = pageElementsAt(x, y)[0] ?? null; element; element = parentOf(element)) {
        if (element.getRootNode() !== document || !isInActiveModal(element)) break;
        const box = element.getBoundingClientRect();
        if (box.left <= area.left + 1 && box.top <= area.top + 1 && box.right >= area.right - 1 && box.bottom >= area.bottom - 1) return element;
    }
    return activeModalDialog() ?? document.body;
}

const fraction = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/**
 * Scrolls the frame so the bottom of the drawing's box is in the window (where its pin and the
 * comment's form go), and some of the box with it
 */
function reveal(box: Bounds, frame: CanvasFrame) {
    const offset = frameOffset(frame);
    const bottom = box.y + box.height + offset.y;
    const top = box.y + offset.y;
    const right = box.x + box.width + offset.x;
    const view = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
    let dy = 0;
    if (bottom > view.height - 96) dy = bottom - (view.height - 96);
    else if (bottom < 96) dy = Math.max(bottom - 96, top - 24);
    let dx = 0;
    if (right > view.width - 24) dx = right - (view.width - 24);
    else if (right < 24) dx = right - 24;
    if (dx || dy) {
        scrollFrameBy(frame, dx, dy);
        // A frame that could not scroll further (its end): the page scrolls the rest
        if (frame) {
            const moved = frameOffset(frame);
            const left = { x: dx - (offset.x - moved.x), y: dy - (offset.y - moved.y) };
            if (Math.abs(left.x) > 1 || Math.abs(left.y) > 1) scrollFrameBy(null, left.x, left.y);
        }
    }
}

export type FinishedDrawing = { position: CommentPoint; element: Element; drawing: CommentDrawing };

/**
 * The comment a drawing becomes: an area around its shapes on the element that holds it, and the shapes
 * from that area's top-left corner. `empty` without shapes, `tooLarge` beyond the API's limits.
 */
export function finishDrawing(shapes: readonly DrawingShape[], frame: CanvasFrame): FinishedDrawing | 'empty' | 'tooLarge' {
    const box = shapesBox(shapes);
    if (!box || !shapes.length) return 'empty';
    reveal(box, frame);
    const offset = frameOffset(frame);
    const area = new DOMRect(box.x + offset.x, box.y + offset.y, box.width, box.height);
    const element = elementAround(area);
    const elementBox = element.getBoundingClientRect();
    if (!elementBox.width || !elementBox.height) return 'empty';
    // Like a dragged area (`CommentPointOverlay`): within the element, measured from its box
    const xNormal = Math.min(fraction((area.left - elementBox.left) / elementBox.width), 1 - 1e-4);
    const yNormal = Math.min(fraction((area.top - elementBox.top) / elementBox.height), 1 - 1e-4);
    const widthNormal = Math.max(1e-4, Math.min(fraction(area.width / elementBox.width), 1 - xNormal));
    const heightNormal = Math.max(1e-4, Math.min(fraction(area.height / elementBox.height), 1 - yNormal));
    // The area as the page will place it again; the shapes are kept from its top-left corner
    const origin = { x: elementBox.left + elementBox.width * xNormal, y: elementBox.top + elementBox.height * yNormal };
    const drawing = parseDrawing({
        version: drawingVersion,
        width: Math.round(box.width),
        height: Math.round(box.height),
        shapes: shapes.map(shape => roundShape(moveShape(shape, offset.x - origin.x, offset.y - origin.y)))
    });
    if (typeof drawing === 'string') return 'tooLarge';
    return {
        position: { type: 'point', selector: anchorSelector(element), xNormal, yNormal, widthNormal, heightNormal },
        element,
        drawing
    };
}

/** A saved drawing's shapes in the page's coordinates again, from its area's place in the window (Edit drawing) */
export function shapesOnPage(drawing: CommentDrawing, area: Pick<DOMRect, 'left' | 'top'>): DrawingShape[] {
    const offset = frameOffset(null);
    return drawing.shapes.map(shape => moveShape(shape, area.left - offset.x, area.top - offset.y));
}
