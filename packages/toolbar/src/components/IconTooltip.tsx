import { cloneElement, useContext, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';

const showDelayMs = 300;
const gap = 6;
const margin = 8;

/**
 * A visible name for an icon-only control: shown above it (below near the top of the window) after a
 * short hover, or at once when the keyboard focuses it. The control keeps its own accessible name, so
 * the tooltip is decorative (`aria-hidden`). It renders into the toolbar's shadow root container with a
 * fixed position, so overflowing popovers and panels never clip it. Touch shows nothing: a tap acts.
 *
 * Spread `triggerProps` on the control and render `tooltip` anywhere (popover triggers merge the props).
 * A `shortcut` shows after the name, in mono.
 */
export function useIconTooltip(label: string, shortcut?: string) {
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const [anchor, setAnchor] = useState<DOMRect>();
    const [placement, setPlacement] = useState<{ left: number; top: number }>();
    const tooltipRef = useRef<HTMLSpanElement>(null);
    const timer = useRef<number>(undefined);
    const hide = () => {
        window.clearTimeout(timer.current);
        setAnchor(undefined);
        setPlacement(undefined);
    };
    const show = (element: Element, delay: number) => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setAnchor(element.getBoundingClientRect()), delay);
    };
    // Keep it inside the window, centred on the control when there is room
    useLayoutEffect(() => {
        const tooltip = tooltipRef.current;
        if (!anchor || !tooltip) return;
        const { width, height } = tooltip.getBoundingClientRect();
        const above = anchor.top - gap - height >= margin;
        const left = Math.min(Math.max(anchor.left + anchor.width / 2 - width / 2, margin), window.innerWidth - margin - width);
        setPlacement({ left, top: above ? anchor.top - gap - height : anchor.bottom + gap });
    }, [anchor]);
    useLayoutEffect(() => () => window.clearTimeout(timer.current), []);

    return {
        triggerProps: {
            onPointerEnter: (event: PointerEvent) => { if (event.pointerType === 'mouse') show(event.currentTarget, showDelayMs); },
            onPointerLeave: hide,
            onPointerDown: hide,
            onFocus: (event: FocusEvent) => { if ((event.currentTarget as Element).matches(':focus-visible')) show(event.currentTarget, 0); },
            onBlur: hide,
            onKeyDown: (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); }
        },
        tooltip: anchor && rootElement ? createPortal(
            <span ref={tooltipRef} aria-hidden="true" data-uier-tooltip=""
                className="pointer-events-none fixed z-[90] max-w-64 rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-sm"
                style={{ left: placement?.left ?? -9999, top: placement?.top ?? -9999 }}>
                {label}
                {/* Mono means machine (BRAND.md); the control names it with `aria-keyshortcuts` */}
                {shortcut && <kbd className="ml-2 font-mono font-normal opacity-70">{shortcut}</kbd>}
            </span>,
            rootElement
        ) : null
    };
}

type Handlers = Partial<ReturnType<typeof useIconTooltip>['triggerProps']>;

/** `useIconTooltip` around one control, keeping the control's own handlers */
export function IconTooltip({ label, shortcut, children }: { label: string; shortcut?: string; children: ReactElement<Handlers> }) {
    const { triggerProps, tooltip } = useIconTooltip(label, shortcut);
    const own = children.props;
    const merged: Handlers = {};
    for (const key of Object.keys(triggerProps) as (keyof Handlers)[]) {
        merged[key] = ((event: never) => {
            (own[key] as ((event: never) => void) | undefined)?.(event);
            (triggerProps[key] as (event: never) => void)(event);
        }) as never;
    }
    return <>{cloneElement(children, merged)}{tooltip}</>;
}
