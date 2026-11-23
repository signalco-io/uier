'use client';

import { useRef, useState, type PointerEvent, type ReactElement, type ReactNode } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { cx } from '@signalco/ui-primitives/cx';
import { Close } from '@signalco/ui-icons';
import { canReviewToolbar, holdsLayersAttribute, type toolbarSurface } from '../toolbarReview';
import { IconTooltip } from './IconTooltip';
import { floatingShadowClassName } from './@types/Comments';

/** How much of the viewer's header stays in the window while it is dragged */
const keepVisible = 48;

/**
 * A larger view of a screenshot or image: a saved thumbnail's (`CommentScreenshot`), the composer's
 * screenshot and an attached image (`ComposerAttachments`, `ComposerAttachMenu`). It opens in the
 * middle of the window over a blurred backdrop like the toolbar's modals (a press on the backdrop
 * closes it), above every toolbar popover, a thread's too (uier #500). It is still the UI kit's
 * popover: Escape closes it and the focus goes back to its thumbnail, and only it closes, not the
 * thread or form it opened from. Its header drags it (uier #497) and holds Close, an X.
 * On uier's own pages presses go through the backdrop, so the pill's Add comment still reaches the
 * viewer for a comment on it, and a press in the viewer keeps the toolbar's other popovers open (the
 * thread a comment on the toolbar is about, `holdsLayersAttribute`).
 */
export function ScreenshotViewer({ open, onOpenChange, trigger, container, label, closeLabel, closeDisabled, surface, className, children }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    trigger: ReactElement;
    container: HTMLElement | undefined;
    /** Its name and the header's title */
    label: string;
    closeLabel: string;
    closeDisabled?: boolean;
    /** `toolbarSurface(part)` of a reviewable viewer; the comment being written is not one */
    surface?: ReturnType<typeof toolbarSurface>;
    className?: string;
    children: ReactNode;
}) {
    const contentRef = useRef<HTMLDivElement>(null);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const drag = useRef<{ pointer: number; x: number; y: number; offset: { x: number; y: number }; rect: DOMRect }>(undefined);
    const change = (next: boolean) => {
        // Every opening starts in the middle again
        if (next) setOffset({ x: 0, y: 0 });
        onOpenChange(next);
    };
    const startDrag = (event: PointerEvent<HTMLDivElement>) => {
        // The header's own controls (Close) keep their presses
        if (event.button !== 0 || (event.target as Element).closest('button') || !contentRef.current) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, offset, rect: contentRef.current.getBoundingClientRect() };
    };
    const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
        const start = drag.current;
        if (!start || start.pointer !== event.pointerId) return;
        const { rect } = start;
        // The header stays reachable: never above the window, and part of it always inside
        const dx = Math.min(Math.max(event.clientX - start.x, keepVisible - rect.right), window.innerWidth - keepVisible - rect.left);
        const dy = Math.min(Math.max(event.clientY - start.y, -rect.top), window.innerHeight - keepVisible - rect.top);
        setOffset({ x: start.offset.x + dx, y: start.offset.y + dy });
    };
    const endDrag = (event: PointerEvent<HTMLDivElement>) => {
        if (drag.current?.pointer === event.pointerId) drag.current = undefined;
    };

    return (
        <Popper
            container={container}
            open={open}
            onOpenChange={change}
            aria-label={label}
            {...surface}
            // Radix's content props the UI kit passes on: the viewer itself takes the focus, so Close
            // does not show its tooltip at once
            {...{
                ref: contentRef,
                onOpenAutoFocus: (event: Event) => { event.preventDefault(); contentRef.current?.focus({ preventScroll: true }); }
            }}
            tabIndex={-1}
            data-uier-viewer={canReviewToolbar() ? 'review' : 'modal'}
            // A press in it keeps the toolbar's other popovers open: the thread a comment on the toolbar is about
            {...{ [holdsLayersAttribute]: '' }}
            style={{ translate: `${offset.x}px ${offset.y}px` }}
            className={cx('z-[78] flex max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl p-0 outline-none', floatingShadowClassName, surface?.className, className)}
            trigger={trigger}>
            <div
                data-uier-viewer-handle=""
                className="flex shrink-0 cursor-grab touch-none select-none items-center gap-2 border-b py-1 pr-1 pl-3 active:cursor-grabbing"
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
                <IconTooltip label={closeLabel}>
                    <IconButton variant="plain" size="xs" type="button" aria-label={closeLabel} disabled={closeDisabled}
                        className="size-8 shrink-0 rounded-md text-muted-foreground hover:text-foreground pointer-coarse:size-11"
                        onClick={() => change(false)}>
                        <Close size={16} aria-hidden="true" />
                    </IconButton>
                </IconTooltip>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3">
                {children}
            </div>
        </Popper>
    );
}

/** An image in a viewer: whole, at most its own size, centred */
export const viewerImageClassName = 'block h-auto max-h-[calc(100dvh-9rem)] w-auto max-w-full self-center rounded-md border object-contain';
