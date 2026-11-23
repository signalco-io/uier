'use client';

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { cx } from '@signalco/ui-primitives/cx';
import { Close } from '@signalco/ui-icons';
import { canReviewToolbar, holdsLayersAttribute, type toolbarSurface } from '../toolbarReview';
import { IconTooltip } from './IconTooltip';
import { useMessages } from '../i18n';
import { floatingShadowClassName } from './@types/Comments';

/** How much of the viewer's header stays in the window while it is moved */
const keepVisible = 48;
/** An arrow key's step, and with Shift */
const keyStep = 16;
const largeKeyStep = 64;

/** Lucide's move, drawn like the UI kit's icons (the kit has none) */
function MoveIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2v20" />
            <path d="m15 19-3 3-3-3" />
            <path d="m19 9 3 3-3 3" />
            <path d="M2 12h20" />
            <path d="m5 9-3 3 3 3" />
            <path d="m9 5 3-3 3 3" />
        </svg>
    );
}

/** The offset after a move by `dx`, `dy` from `rect`: never above the window, and part of the header always inside */
function clampedMove(rect: DOMRect, dx: number, dy: number) {
    return {
        x: Math.min(Math.max(dx, keepVisible - rect.right), window.innerWidth - keepVisible - rect.left),
        y: Math.min(Math.max(dy, -rect.top), window.innerHeight - keepVisible - rect.top)
    };
}

/**
 * A larger view of a screenshot or image: a saved thumbnail's (`CommentScreenshot`), the composer's
 * screenshot and an attached image (`ComposerAttachments`, `ComposerAttachMenu`). It opens in the
 * middle of the window over a blurred backdrop like the toolbar's modals (a press on the backdrop
 * closes it), above every toolbar popover, a thread's too (uier #500). It is still the UI kit's
 * popover: Escape closes it and the focus goes back to its thumbnail, and only it closes, not the
 * thread or form it opened from. Its header drags it (uier #497) and holds Close, an X. Without dragging,
 * its Move button moves it with the arrow keys, and Enter (or a press) puts it back in the middle.
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
    const t = useMessages();
    const helpId = useId();
    const contentRef = useRef<HTMLDivElement>(null);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const drag = useRef<{ pointer: number; x: number; y: number; offset: { x: number; y: number }; rect: DOMRect; moved: boolean }>(undefined);
    // A drag that started on Move is not also its press
    const dragged = useRef(false);
    const change = (next: boolean) => {
        // Every opening starts in the middle again
        if (next) setOffset({ x: 0, y: 0 });
        onOpenChange(next);
    };
    const startDrag = (event: PointerEvent<HTMLDivElement>) => {
        // Close keeps its presses; Move drags too
        const button = (event.target as Element).closest('button');
        if (event.button !== 0 || (button && !button.hasAttribute('data-uier-viewer-move')) || !contentRef.current) return;
        event.preventDefault();
        // On Move, its own capture: its click (a press that did not drag) still reaches it
        (button ?? event.currentTarget).setPointerCapture(event.pointerId);
        dragged.current = false;
        drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, offset, rect: contentRef.current.getBoundingClientRect(), moved: false };
    };
    const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
        const start = drag.current;
        if (!start || start.pointer !== event.pointerId) return;
        if (Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y) > 3) start.moved = true;
        const { x, y } = clampedMove(start.rect, event.clientX - start.x, event.clientY - start.y);
        setOffset({ x: start.offset.x + x, y: start.offset.y + y });
    };
    const endDrag = (event: PointerEvent<HTMLDivElement>) => {
        if (drag.current?.pointer !== event.pointerId) return;
        dragged.current = drag.current.moved;
        drag.current = undefined;
    };
    // Move with the keyboard: the arrow keys (a larger step with Shift), like a drag
    const moveByKey = (event: KeyboardEvent<HTMLButtonElement>) => {
        const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const direction = directions[event.key];
        const rect = contentRef.current?.getBoundingClientRect();
        if (!direction || !rect) return;
        event.preventDefault();
        const step = event.shiftKey ? largeKeyStep : keyStep;
        const { x, y } = clampedMove(rect, direction[0] * step, direction[1] * step);
        setOffset(current => ({ x: current.x + x, y: current.y + y }));
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
                className="flex shrink-0 cursor-grab touch-none select-none items-center gap-1 border-b py-1 pr-1 pl-3 active:cursor-grabbing"
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}>
                <span id={helpId} className="sr-only">{t.screenshot.moveHelp}</span>
                <IconTooltip label={t.screenshot.move} shortcut="← ↑ → ↓">
                    <IconButton variant="plain" size="xs" type="button" aria-label={t.screenshot.move} aria-describedby={helpId}
                        aria-keyshortcuts="ArrowLeft ArrowUp ArrowRight ArrowDown Enter"
                        data-uier-viewer-move=""
                        className="-ml-2 size-8 shrink-0 cursor-grab touch-none rounded-md text-muted-foreground hover:text-foreground active:cursor-grabbing pointer-coarse:size-11"
                        onKeyDown={moveByKey}
                        // A press (Enter, Space, a click that did not drag) puts it back in the middle
                        onClick={() => { if (!dragged.current) setOffset({ x: 0, y: 0 }); dragged.current = false; }}>
                        <MoveIcon />
                    </IconButton>
                </IconTooltip>
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
