import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';

/**
 * A `Popper` that opens on hover as well as on click (a comment's device), like the app's hook of
 * the same name: opened by a click (or the keyboard) it moves focus in and stays open until
 * dismissed; opened by hovering it leaves focus alone and closes when the pointer leaves. Spread
 * `root` and `content` on the `Popper` and `trigger` on its trigger. Escape closes only the
 * popover, not the thread or the inbox around it (they close on Escape too).
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
    // Radix's own first focus compares `document.activeElement`, which is the shadow host here, so
    // it would end on the content: focus its first button (or the content, without one) instead
    const focusIn = (event: Event) => {
        event.preventDefault();
        if (!pinned) return;
        const content = event.target as HTMLElement;
        (content.querySelector<HTMLElement>('button') ?? content).focus();
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
            },
            onKeyDown: (event: KeyboardEvent) => {
                if (open && event.key === 'Escape') event.stopPropagation();
            }
        },
        // Radix props passed through the Popper to the popover content
        content: {
            onPointerEnter: hoverOpen,
            onPointerLeave: hoverClose,
            onOpenAutoFocus: focusIn,
            onCloseAutoFocus: keepFocus,
            onKeyDown: (event: KeyboardEvent) => {
                if (event.key === 'Escape') event.stopPropagation();
            }
        }
    };
}
