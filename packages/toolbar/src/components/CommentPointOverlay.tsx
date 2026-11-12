import { memo, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { anchorSelector } from '../anchorSelector';
import { CommentPoint } from './@types/Comments';
import { canReviewToolbar, holdToolbarLayers, toolbarReviewTarget } from '../toolbarReview';
import { getToolbarHost } from '../mount';
import { activeModalDialog, isInActiveModal } from '../modalLayer';
import { useLayoutVersion } from '../hooks/useLayoutVersion';
import { CommentIcon } from './CommentIcon';
import { cx } from '@signalco/ui-primitives/cx';

type CommentPointOverlayProps = {
    /** With the element it is on (a toolbar part's opener is found from it, `layerAnchor.ts`) */
    onPoint: (commentPoint: CommentPoint, element: Element) => void;
};

/** How far the pointer moves before pressing becomes drawing an area, and an area's smallest side */
const dragThreshold = 4;
const areaMinSize = 8;

// Point mode does not cover the page. Its presses are taken on the window in the capture phase,
// before any listener of the page, so the page never sees them: nothing is activated, focused,
// selected or dragged, and menus, popovers and dialogs that close on a press or focus outside
// stay open. The pointer's moves still reach the page, so hover menus and hover states stay too.
/** Presses taken from the page (the click pins; a mouse or pen drag draws an area) */
const pressEvents = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu'];
/** Taken without cancelling, so a finger keeps scrolling the page */
const touchEvents = ['touchstart', 'touchend'];
/** Text selection and native drags of links and pictures, from a mouse or a long press */
const defaultEvents = ['selectstart', 'dragstart'];
/**
 * Default actions to cancel: focus, selection, drags and the native picker (mousedown), links, forms
 * and controls (click), new tabs (auxclick). The browser's context menu stays, as over the old cover.
 */
const cancelledEvents = new Set(['mousedown', 'click', 'dblclick', 'auxclick', ...defaultEvents]);

/**
 * Whether the event points at something to comment on: anything outside the review layer; the
 * layer's pins, highlights and frame shields (what is under them is pinned); and on uier's own
 * pages the toolbar's parts: the pill, the inbox, its threads, popovers and menus. The rest of the
 * review layer, such as the point-mode instruction and its Cancel, the comment being written or,
 * on reviewed sites, the whole toolbar, keeps working.
 */
function pointsAtPage(event: Event) {
    const host = getToolbarHost();
    const path = event.composedPath();
    if (!host || !path.includes(host)) return true;
    const target = path[0];
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('[data-uier-comment],[data-uier-highlight],[data-uier-shield]') || toolbarReviewTarget(target));
}

/** Whether the point is inside the element's own boxes, not only inside one of its pseudo-elements */
function ownBoxAt(element: Element, x: number, y: number) {
    return [...element.getClientRects()].some(rect =>
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
}

/** Only uier's own pages can cross the toolbar's shadow boundary while choosing an anchor. */
function pageElementAt(x: number, y: number) {
    if (canReviewToolbar()) {
        const root = getToolbarHost()?.shadowRoot;
        const target = root?.elementsFromPoint(x, y).find(element => toolbarReviewTarget(element));
        if (target) return toolbarReviewTarget(target)!;
    }
    // With a modal dialog open only its content can be reviewed: not the inert page behind its
    // backdrop, nor the backdrop itself (hit as the dialog, outside the dialog's own box)
    const modal = activeModalDialog();
    const elements = window.document.elementsFromPoint(x, y)
        ?.filter(el => el && el !== getToolbarHost() && isInActiveModal(el) && (el !== modal || ownBoxAt(el, x, y))) ?? [];
    // A stretched link (`::after` over its whole row or card) is hit everywhere on the row: prefer
    // the element under it that is actually at the point (the row's picture, summary or badge).
    return elements.find(el => ownBoxAt(el, x, y)) ?? elements.at(0);
}

/** The innermost page element whose box holds the whole area, found up from the area's middle */
function pageElementAround(area: DOMRect) {
    for (let element: Element | null | undefined = pageElementAt(area.left + area.width / 2, area.top + area.height / 2); element; element = element.parentElement) {
        // Up from a reviewed toolbar surface, the rest of the toolbar is not an anchor
        if (element.getRootNode() !== document && !toolbarReviewTarget(element)) break;
        // Nor, from inside an open modal dialog, the inert page around it
        if (!isInActiveModal(element)) break;
        const box = element.getBoundingClientRect();
        if (box.left <= area.left + 1 && box.top <= area.top + 1 && box.right >= area.right - 1 && box.bottom >= area.bottom - 1) {
            return element;
        }
    }
    return activeModalDialog() ?? document.body;
}

function clampFraction(value: number) {
    return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/** The dragged area as a point (its top-left corner) and size on the element that holds it */
function areaPoint(area: DOMRect): { point: CommentPoint; element: Element } | undefined {
    const element = pageElementAround(area);
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) return undefined;
    const xNormal = clampFraction((area.left - box.left) / box.width);
    const yNormal = clampFraction((area.top - box.top) / box.height);
    const widthNormal = Math.min(clampFraction(area.width / box.width), 1 - xNormal);
    const heightNormal = Math.min(clampFraction(area.height / box.height), 1 - yNormal);
    return widthNormal > 0 && heightNormal > 0
        ? { point: { type: 'point', selector: anchorSelector(element), xNormal, yNormal, widthNormal, heightNormal }, element }
        : undefined;
}

/** The area between the drag's start (page coordinates, so it stays put while scrolling) and the pointer */
function draggedArea(start: { x: number; y: number }, pointer: { x: number; y: number }) {
    const x = start.x - window.scrollX;
    const y = start.y - window.scrollY;
    return new DOMRect(Math.min(x, pointer.x), Math.min(y, pointer.y), Math.abs(pointer.x - x), Math.abs(pointer.y - y));
}

/** The page's frames in the window (the active modal's, while one is open) */
function frameRects() {
    const rects: DOMRect[] = [];
    for (const frame of document.querySelectorAll('iframe,embed,object')) {
        if (!isInActiveModal(frame)) continue;
        const rect = frame.getBoundingClientRect();
        if (rect.width && rect.height && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth) {
            rects.push(rect);
        }
    }
    return rects;
}

/** How many point overlays are on the page (one at a time; reattaching uses one too) */
let pointing = 0;

/** Whether point mode is on: a pin's hover preview does not open while a place is being chosen */
export function isPointing() {
    return pointing > 0;
}

/**
 * A frame's presses go to its own document, where the window's listeners do not see them: while
 * pointing, a transparent shield over each frame takes them, and the frame is what gets pinned.
 */
const FrameShields = memo(function FrameShields() {
    useLayoutVersion();
    return frameRects().map((rect, i) => (
        <div
            key={i}
            aria-hidden="true"
            data-uier-shield=""
            data-uier-capture-exclude=""
            className={canReviewToolbar() ? 'fixed z-[52]' : 'fixed z-50'}
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />
    ));
});

export function CommentPointOverlay({ onPoint }: CommentPointOverlayProps) {
    // The element a click would comment on, outlined while the pointer is over it
    const [hoveredRect, setHoveredRect] = useState<DOMRect | null>(null);
    // The area being dragged over the page (mouse and pen; a finger keeps scrolling the page)
    const [area, setArea] = useState<DOMRect | null>(null);
    // The add-comment pin beside a mouse or pen pointer: the page keeps its own cursor
    const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
    const pointerRef = useRef<{ x: number; y: number; fine: boolean } | null>(null);
    const dragRef = useRef<{ pointerId: number; x: number; y: number; dragging: boolean } | null>(null);
    // The click that ends a drag does not pin a comment as well
    const draggedRef = useRef(false);
    const frameRef = useRef<number>(undefined);

    const updateHovered = useEffectEvent(() => {
        window.cancelAnimationFrame(frameRef.current ?? 0);
        frameRef.current = window.requestAnimationFrame(() => {
            const pointer = pointerRef.current;
            const drag = dragRef.current;
            setCursor(pointer?.fine ? { x: pointer.x, y: pointer.y } : null);
            if (drag?.dragging && pointer) {
                setArea(draggedArea(drag, pointer));
                setHoveredRect(null);
                return;
            }
            const element = pointer ? pageElementAt(pointer.x, pointer.y) : undefined;
            setHoveredRect(element ? element.getBoundingClientRect() : null);
        });
    });

    // The pointer is over the review layer's own controls or left the window
    const clearPointer = useEffectEvent(() => {
        pointerRef.current = null;
        window.cancelAnimationFrame(frameRef.current ?? 0);
        setHoveredRect(null);
        setCursor(null);
    });

    /** Pins the comment to the element at this point of the window */
    const pinAt = useEffectEvent((x: number, y: number) => {
        const el = pageElementAt(x, y);
        if (!el) return;

        const selector = anchorSelector(el);
        const elBounds = el.getBoundingClientRect();
        const relativeX = x - elBounds.left;
        const relativeY = y - elBounds.top;

        onPoint({
            type: 'point',
            selector,
            xNormal: Math.min(1, Math.max(0, elBounds.width ? relativeX / elBounds.width : 0)),
            yNormal: Math.min(1, Math.max(0, elBounds.height ? relativeY / elBounds.height : 0))
        }, el);
    });

    const handlePointerMove = useEffectEvent((event: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag && !pointsAtPage(event)) {
            clearPointer();
            return;
        }
        pointerRef.current = { x: event.clientX, y: event.clientY, fine: event.pointerType !== 'touch' };
        if (drag?.pointerId === event.pointerId && !drag.dragging) {
            const start = draggedArea(drag, pointerRef.current);
            drag.dragging = Math.max(start.width, start.height) > dragThreshold;
        }
        updateHovered();
    });

    const handlePress = useEffectEvent((event: Event) => {
        // Only the reviewer's own presses: a script's click (the page's, or the toolbar's own as it
        // closes or opens its popovers, toolbarReview.ts) is not a place to pin a comment
        if (!event.isTrusted) return;
        const drag = dragRef.current;
        // A drag keeps its moves and release wherever they go, the toolbar included
        const dragEvent = drag && event instanceof PointerEvent && event.pointerId === drag.pointerId;
        if (!dragEvent && !pointsAtPage(event)) return;
        event.stopImmediatePropagation();
        if (event.cancelable && cancelledEvents.has(event.type)) event.preventDefault();

        if (event.type === 'pointerdown' && event instanceof PointerEvent) {
            draggedRef.current = false;
            if (event.pointerType !== 'touch' && event.button === 0) {
                dragRef.current = { pointerId: event.pointerId, x: event.clientX + window.scrollX, y: event.clientY + window.scrollY, dragging: false };
            }
        } else if (event.type === 'pointerup' && dragEvent) {
            dragRef.current = null;
            if (!drag.dragging) return;
            draggedRef.current = true;
            setArea(null);
            updateHovered();
            // A short drag is a click where it started
            const dragged = draggedArea(drag, { x: event.clientX, y: event.clientY });
            const area = dragged.width >= areaMinSize && dragged.height >= areaMinSize ? areaPoint(dragged) : undefined;
            if (area) onPoint(area.point, area.element);
            else pinAt(drag.x - window.scrollX, drag.y - window.scrollY);
        } else if (event.type === 'click' && event instanceof MouseEvent) {
            if (draggedRef.current) {
                draggedRef.current = false;
                return;
            }
            pinAt(event.clientX, event.clientY);
        }
    });

    const handlePointerCancel = useEffectEvent(() => {
        dragRef.current = null;
        setArea(null);
    });

    // On uier's own pages the toolbar's popovers stay open while they are pointed at. A layout
    // effect: the hold ends before the new comment's text box takes the focus (`autoFocus`)
    useLayoutEffect(() => holdToolbarLayers(), []);
    useLayoutEffect(() => {
        pointing++;
        return () => { pointing--; };
    }, []);

    useEffect(() => {
        const move = (event: PointerEvent) => handlePointerMove(event);
        const press = (event: Event) => handlePress(event);
        const cancel = () => handlePointerCancel();
        const leave = (event: PointerEvent) => {
            if (!event.relatedTarget && !dragRef.current) clearPointer();
        };
        // Scrolling moves another element under the pointer, and the page under a dragged area
        const scroll = () => updateHovered();
        window.addEventListener('pointermove', move, { capture: true, passive: true });
        window.addEventListener('pointerout', leave, { capture: true, passive: true });
        window.addEventListener('pointercancel', cancel, { capture: true, passive: true });
        window.addEventListener('scroll', scroll, { capture: true, passive: true });
        for (const type of [...pressEvents, ...defaultEvents]) window.addEventListener(type, press, { capture: true });
        for (const type of touchEvents) window.addEventListener(type, press, { capture: true, passive: true });
        return () => {
            window.removeEventListener('pointermove', move, { capture: true });
            window.removeEventListener('pointerout', leave, { capture: true });
            window.removeEventListener('pointercancel', cancel, { capture: true });
            window.removeEventListener('scroll', scroll, { capture: true });
            for (const type of [...pressEvents, ...defaultEvents, ...touchEvents]) window.removeEventListener(type, press, { capture: true });
            window.cancelAnimationFrame(frameRef.current ?? 0);
        };
    }, []);

    // On uier's own pages over the toolbar's popovers and menus too, which can be pointed at
    const layer = canReviewToolbar() ? 'z-[95]' : 'z-[53]';
    return (
        <>
            <FrameShields />
            {/* Drawn over the element instead of styling it: nothing on the page changes (accent blue, BRAND.md "The review layer") */}
            {hoveredRect && (
                <div
                    aria-hidden="true"
                    data-uier-outline=""
                    className={cx('pointer-events-none fixed rounded-sm outline-2 outline-offset-2 outline-dashed outline-[hsl(var(--brand-accent))]', layer)}
                    style={{
                        left: hoveredRect.left,
                        top: hoveredRect.top,
                        width: hoveredRect.width,
                        height: hoveredRect.height
                    }} />
            )}
            {/* The area being drawn: the selection tint inside the same dashed outline */}
            {area && (
                <div
                    aria-hidden="true"
                    data-uier-drawing=""
                    className={cx('pointer-events-none fixed rounded-sm bg-[hsl(var(--brand-selection))] outline-2 outline-dashed outline-[hsl(var(--brand-accent))]', layer)}
                    style={{
                        left: area.left,
                        top: area.top,
                        width: area.width,
                        height: area.height
                    }} />
            )}
            {cursor && !area && (
                <CommentIcon
                    icon="add"
                    size={20}
                    aria-hidden="true"
                    data-uier-pointer=""
                    data-uier-capture-exclude=""
                    className={cx('pointer-events-none fixed', layer)}
                    style={{ left: cursor.x + 12, top: cursor.y + 14 }} />
            )}
        </>
    );
}
