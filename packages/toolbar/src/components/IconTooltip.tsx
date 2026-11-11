import { cloneElement, createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '@signalco/ui-primitives/cx';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';

const showDelayMs = 300;

/**
 * Where tooltips go instead of the shadow root's container: a modal dialog (`ComposerModal`), whose
 * top layer would otherwise cover them
 */
export const TooltipContainerContext = createContext<HTMLElement | null>(null);
const gap = 6;
const margin = 8;

/**
 * A visible name for an icon-only control: shown above it (below near the top of the window) after a
 * short hover, or at once when the keyboard focuses it. The control keeps its own accessible name, so
 * the tooltip is decorative (`aria-hidden`). It renders into the toolbar's shadow root container with a
 * fixed position, so overflowing popovers and panels never clip it. Touch shows nothing: a tap acts.
 *
 * Spread `triggerProps` on the control and render `tooltip` anywhere (popover triggers merge the props).
 * A `shortcut` shows after the name, in mono. With `tap` the control does nothing else, so a tap (or
 * Enter) shows it too and a second tap hides it; a tap elsewhere or a scroll hides it. Such a tooltip
 * holds words the control's `aria-describedby` reads, and `prose` sets it as text, not a name.
 */
export function useIconTooltip(label: string, shortcut?: string, { tap = false, prose = false }: { tap?: boolean; prose?: boolean } = {}) {
    const { rootElement: shadowContainer } = useContext(CommentsBootstrapperContext);
    const rootElement = useContext(TooltipContainerContext) ?? shadowContainer;
    const [anchor, setAnchor] = useState<DOMRect>();
    const [placement, setPlacement] = useState<{ left: number; top: number }>();
    const tooltipRef = useRef<HTMLSpanElement>(null);
    const timer = useRef<number>(undefined);
    const trigger = useRef<Element>(undefined);
    // Whether a touch or pen press began on a shown tooltip (its click then hides it)
    const pressed = useRef<{ touch: boolean; open: boolean }>(undefined);
    const hide = () => {
        window.clearTimeout(timer.current);
        setAnchor(undefined);
        setPlacement(undefined);
    };
    const show = (element: Element, delay: number) => {
        window.clearTimeout(timer.current);
        trigger.current = element;
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
    // A tapped tooltip stays until a press elsewhere or a scroll (it is placed where the control was)
    useEffect(() => {
        if (!tap || !anchor) return;
        const outside = (event: Event) => { if (!trigger.current || !event.composedPath().includes(trigger.current)) hide(); };
        window.addEventListener('pointerdown', outside, true);
        window.addEventListener('scroll', hide, true);
        return () => {
            window.removeEventListener('pointerdown', outside, true);
            window.removeEventListener('scroll', hide, true);
        };
    }, [tap, anchor]);

    return {
        /** Shows it at once on the control (a long press, which the control handles itself), and hides it */
        open: (element: Element) => show(element, 0),
        close: hide,
        triggerProps: {
            onPointerEnter: (event: PointerEvent) => { if (event.pointerType === 'mouse') show(event.currentTarget, showDelayMs); },
            onPointerLeave: hide,
            onPointerDown: (event: PointerEvent) => {
                if (tap) pressed.current = { touch: event.pointerType !== 'mouse', open: anchor !== undefined };
                hide();
            },
            ...tap ? {
                onClick: (event: MouseEvent) => {
                    const press = pressed.current;
                    pressed.current = undefined;
                    if (!press?.touch || !press.open) show(event.currentTarget, 0);
                }
            } : {},
            onFocus: (event: FocusEvent) => { if ((event.currentTarget as Element).matches(':focus-visible')) show(event.currentTarget, 0); },
            onBlur: hide,
            onKeyDown: (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); }
        },
        tooltip: anchor && rootElement ? createPortal(
            <span ref={tooltipRef} aria-hidden="true" data-uier-tooltip=""
                className={cx('pointer-events-none fixed z-[90] max-w-64 rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-sm', prose ? 'font-normal' : 'font-medium')}
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
