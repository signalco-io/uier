import React, { useEffect, useRef, useState } from 'react';
import { cx } from '@signalco/ui-primitives/cx';
import { anchorSelector } from '../anchorSelector';
import { CommentPoint } from './@types/Comments';
import { canReviewToolbar, toolbarReviewTarget } from '../toolbarReview';
import { getToolbarHost } from '../mount';
import { activeModalDialog, isInActiveModal } from '../modalLayer';

type CommentPointOverlayProps = {
    onPoint: (commentPoint: CommentPoint) => void;
};

/** How far the pointer moves before pressing becomes drawing an area, and an area's smallest side */
const dragThreshold = 4;
const areaMinSize = 8;

/** Whether the point is inside the element's own boxes, not only inside one of its pseudo-elements */
function ownBoxAt(element: Element, x: number, y: number) {
    return [...element.getClientRects()].some(rect =>
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
}

/** Only uier's own pages can cross the toolbar's shadow boundary while choosing an anchor. */
function pageElementAt(x: number, y: number) {
    if (canReviewToolbar()) {
        const root = getToolbarHost()?.shadowRoot;
        const target = root?.elementsFromPoint(x, y).find(element =>
            !element.closest('.review-overlay,[data-uier-outline]') && toolbarReviewTarget(element));
        if (target) return toolbarReviewTarget(target)!;
    }
    // With a modal dialog open only its content can be reviewed: not the inert page behind its
    // backdrop, nor the backdrop itself (hit as the dialog, outside the dialog's own box)
    const modal = activeModalDialog();
    const elements = window.document.elementsFromPoint(x, y)
        ?.filter(el => el && el !== getToolbarHost() && !el.classList.contains('review-overlay')
            && isInActiveModal(el) && (el !== modal || ownBoxAt(el, x, y))) ?? [];
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
function areaPoint(area: DOMRect): CommentPoint | undefined {
    const element = pageElementAround(area);
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) return undefined;
    const xNormal = clampFraction((area.left - box.left) / box.width);
    const yNormal = clampFraction((area.top - box.top) / box.height);
    const widthNormal = Math.min(clampFraction(area.width / box.width), 1 - xNormal);
    const heightNormal = Math.min(clampFraction(area.height / box.height), 1 - yNormal);
    return widthNormal > 0 && heightNormal > 0
        ? { type: 'point', selector: anchorSelector(element), xNormal, yNormal, widthNormal, heightNormal }
        : undefined;
}

/** The area between the drag's start (page coordinates, so it stays put while scrolling) and the pointer */
function draggedArea(start: { x: number; y: number }, pointer: { x: number; y: number }) {
    const x = start.x - window.scrollX;
    const y = start.y - window.scrollY;
    return new DOMRect(Math.min(x, pointer.x), Math.min(y, pointer.y), Math.abs(pointer.x - x), Math.abs(pointer.y - y));
}

export function CommentPointOverlay({ onPoint }: CommentPointOverlayProps) {
    // The element a click would comment on, outlined while the pointer is over it
    const [hoveredRect, setHoveredRect] = useState<DOMRect | null>(null);
    // The area being dragged over the page (mouse and pen; a finger keeps scrolling the page)
    const [area, setArea] = useState<DOMRect | null>(null);
    const pointerRef = useRef<{ x: number; y: number } | null>(null);
    const dragRef = useRef<{ pointerId: number; x: number; y: number; dragging: boolean } | null>(null);
    // The click that ends a drag does not pin a comment as well
    const draggedRef = useRef(false);
    const frameRef = useRef<number>(undefined);

    const updateHovered = () => {
        window.cancelAnimationFrame(frameRef.current ?? 0);
        frameRef.current = window.requestAnimationFrame(() => {
            const pointer = pointerRef.current;
            const drag = dragRef.current;
            if (drag?.dragging && pointer) {
                setArea(draggedArea(drag, pointer));
                setHoveredRect(null);
                return;
            }
            const element = pointer ? pageElementAt(pointer.x, pointer.y) : undefined;
            setHoveredRect(element ? element.getBoundingClientRect() : null);
        });
    };

    // Scrolling moves another element under the pointer, and the page under a dragged area
    useEffect(() => {
        window.addEventListener('scroll', updateHovered, { passive: true, capture: true });
        return () => {
            window.removeEventListener('scroll', updateHovered, { capture: true });
            window.cancelAnimationFrame(frameRef.current ?? 0);
        };
    }, []);

    const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
        pointerRef.current = { x: event.clientX, y: event.clientY };
        updateHovered();
    };

    // The pointer is over the toolbar (above the overlay) or left the window
    const handleMouseLeave = () => {
        if (dragRef.current) return;
        pointerRef.current = null;
        window.cancelAnimationFrame(frameRef.current ?? 0);
        setHoveredRect(null);
    };

    /** Pins the comment to the element at this point of the window */
    const pinAt = (x: number, y: number) => {
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
        });
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        draggedRef.current = false;
        if (event.pointerType === 'touch' || event.button !== 0) return;
        dragRef.current = { pointerId: event.pointerId, x: event.clientX + window.scrollX, y: event.clientY + window.scrollY, dragging: false };
        // Moves over the toolbar (above the overlay) still draw the area
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (drag?.pointerId !== event.pointerId) return;
        pointerRef.current = { x: event.clientX, y: event.clientY };
        if (!drag.dragging) {
            const start = draggedArea(drag, pointerRef.current);
            drag.dragging = Math.max(start.width, start.height) > dragThreshold;
        }
        if (drag.dragging) updateHovered();
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (drag?.pointerId !== event.pointerId) return;
        dragRef.current = null;
        if (!drag.dragging) return;
        draggedRef.current = true;
        setArea(null);
        updateHovered();
        // A short drag is a click where it started
        const dragged = draggedArea(drag, { x: event.clientX, y: event.clientY });
        const point = dragged.width >= areaMinSize && dragged.height >= areaMinSize ? areaPoint(dragged) : undefined;
        if (point) onPoint(point);
        else pinAt(drag.x - window.scrollX, drag.y - window.scrollY);
    };

    const handlePointerCancel = () => {
        dragRef.current = null;
        setArea(null);
    };

    // On embedded sites the toolbar stays above the overlay and its controls keep working.
    const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (draggedRef.current) {
            draggedRef.current = false;
            return;
        }
        pinAt(event.clientX, event.clientY);
    };

    return (
        <>
            <div
                onClick={handleClick}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
                className={cx(
                    'review-overlay',
                    'select-none fixed top-0 left-0 w-full h-full',
                    canReviewToolbar() ? 'z-[52]' : 'z-50',
                    area
                        ? 'cursor-crosshair'
                        : 'cursor-[url("data:image/svg+xml;utf8,%3Csvg%20width%3D%2232%22%20height%3D%2232%22%20viewBox%3D%220%200%2032%2032%22%20fill%3D%22none%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cpath%20d%3D%22M31%2016C31%2024.2843%2024.2843%2031%2016%2031C7.71574%2031%201.00001%2024.2843%201.00001%2016L1.00003%206.40219L1.00004%201.90082L1.00004%201L1.85657%201L6.28413%201L16%201.00001C24.2843%201.00001%2031%207.71574%2031%2016Z%22%20fill%3D%22black%22%20stroke%3D%22white%22%20stroke-width%3D%222%22/%3E%3Cpath%20d%3D%22M9%2016H23%22%20stroke%3D%22white%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22/%3E%3Cpath%20d%3D%22M16%209V23%22%20stroke%3D%22white%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22/%3E%3C/svg%3E"),auto]'
                )} />
            {/* Drawn over the element instead of styling it: nothing on the page changes (accent blue, BRAND.md "The review layer") */}
            {hoveredRect && (
                <div
                    aria-hidden="true"
                    data-uier-outline=""
                    className="pointer-events-none fixed z-[53] rounded-sm outline-2 outline-offset-2 outline-dashed outline-[hsl(var(--brand-accent))]"
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
                    className="pointer-events-none fixed z-[53] rounded-sm bg-[hsl(var(--brand-selection))] outline-2 outline-dashed outline-[hsl(var(--brand-accent))]"
                    style={{
                        left: area.left,
                        top: area.top,
                        width: area.width,
                        height: area.height
                    }} />
            )}
        </>
    );
}
