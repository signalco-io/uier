'use client';

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

/**
 * A popover that opens on hover as well as on click (the project's access info, a comment's
 * device): opened by a click (or the keyboard) it moves focus in and stays open until dismissed;
 * opened by hovering it leaves focus alone and closes when the pointer leaves. Spread `root` on
 * `Popover`, `trigger` on `PopoverTrigger` and `content` on `PopoverContent`.
 */
export function useHoverPopover() {
    const [open, setOpen] = useState(false);
    // Kept after closing, so focus returns to the trigger only when a click opened it
    const [pinned, setPinned] = useState(false);
    const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
    useEffect(() => () => clearTimeout(closeTimer.current), []);

    const hoverOpen = (event: PointerEvent) => {
        if (event.pointerType !== 'mouse') return;
        clearTimeout(closeTimer.current);
        if (!open) setPinned(false);
        setOpen(true);
    };
    const hoverClose = (event: PointerEvent) => {
        if (event.pointerType !== 'mouse' || pinned) return;
        clearTimeout(closeTimer.current);
        closeTimer.current = setTimeout(() => setOpen(false), 150);
    };
    const keepFocus = (event: Event) => {
        if (!pinned) event.preventDefault();
    };

    return {
        root: {
            open,
            onOpenChange: (next: boolean) => {
                clearTimeout(closeTimer.current);
                setOpen(next);
                if (next) setPinned(true);
            }
        },
        trigger: {
            onPointerEnter: hoverOpen,
            onPointerLeave: hoverClose,
            onClick: (event: MouseEvent) => {
                // Clicking while hover-opened pins it instead of closing it
                if (open && !pinned) {
                    event.preventDefault();
                    setPinned(true);
                }
            }
        },
        content: {
            onPointerEnter: hoverOpen,
            onPointerLeave: hoverClose,
            onOpenAutoFocus: keepFocus,
            onCloseAutoFocus: keepFocus
        }
    };
}
