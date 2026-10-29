import React, { useEffect, useRef, useState } from 'react';
import { cx } from '@signalco/ui-primitives/cx';
import { anchorSelector } from '../anchorSelector';
import { CommentPoint } from './@types/Comments';
import { canReviewToolbar, toolbarReviewTarget } from '../toolbarReview';
import { getToolbarHost } from '../mount';

type CommentPointOverlayProps = {
    onPoint: (commentPoint: CommentPoint) => void;
};

/** Only uier's own pages can cross the toolbar's shadow boundary while choosing an anchor. */
function pageElementAt(x: number, y: number) {
    if (canReviewToolbar()) {
        const root = getToolbarHost()?.shadowRoot;
        const target = root?.elementsFromPoint(x, y).find(element =>
            !element.closest('.review-overlay,[data-uier-outline]') && toolbarReviewTarget(element));
        if (target) return toolbarReviewTarget(target)!;
    }
    return window.document.elementsFromPoint(x, y)
        ?.filter(el => el && el !== getToolbarHost() && !el.classList.contains('review-overlay'))
        .at(0);
}

export function CommentPointOverlay({ onPoint }: CommentPointOverlayProps) {
    // The element a click would comment on, outlined while the pointer is over it
    const [hoveredRect, setHoveredRect] = useState<DOMRect | null>(null);
    const pointerRef = useRef<{ x: number; y: number } | null>(null);
    const frameRef = useRef<number>(undefined);

    const updateHovered = () => {
        window.cancelAnimationFrame(frameRef.current ?? 0);
        frameRef.current = window.requestAnimationFrame(() => {
            const pointer = pointerRef.current;
            const element = pointer ? pageElementAt(pointer.x, pointer.y) : undefined;
            setHoveredRect(element ? element.getBoundingClientRect() : null);
        });
    };

    // Scrolling moves another element under the pointer
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
        pointerRef.current = null;
        window.cancelAnimationFrame(frameRef.current ?? 0);
        setHoveredRect(null);
    };

    // On embedded sites the toolbar stays above the overlay and its controls keep working.
    const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
        const el = pageElementAt(event.clientX, event.clientY);
        if (!el) return;

        const selector = anchorSelector(el);
        const elBounds = el.getBoundingClientRect();
        const relativeX = event.clientX - elBounds.left;
        const relativeY = event.clientY - elBounds.top;

        onPoint({
            type: 'point',
            selector,
            xNormal: Math.min(1, Math.max(0, elBounds.width ? relativeX / elBounds.width : 0)),
            yNormal: Math.min(1, Math.max(0, elBounds.height ? relativeY / elBounds.height : 0))
        });
    };

    return (
        <>
            <div
                onClick={handleClick}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                className={cx(
                    'review-overlay',
                    'select-none fixed top-0 left-0 w-full h-full',
                    canReviewToolbar() ? 'z-[52]' : 'z-50',
                    'cursor-[url("data:image/svg+xml;utf8,%3Csvg%20width%3D%2232%22%20height%3D%2232%22%20viewBox%3D%220%200%2032%2032%22%20fill%3D%22none%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cpath%20d%3D%22M31%2016C31%2024.2843%2024.2843%2031%2016%2031C7.71574%2031%201.00001%2024.2843%201.00001%2016L1.00003%206.40219L1.00004%201.90082L1.00004%201L1.85657%201L6.28413%201L16%201.00001C24.2843%201.00001%2031%207.71574%2031%2016Z%22%20fill%3D%22black%22%20stroke%3D%22white%22%20stroke-width%3D%222%22/%3E%3Cpath%20d%3D%22M9%2016H23%22%20stroke%3D%22white%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22/%3E%3Cpath%20d%3D%22M16%209V23%22%20stroke%3D%22white%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22/%3E%3C/svg%3E"),auto]'
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
        </>
    );
}
