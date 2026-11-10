import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type PropsWithChildren, type KeyboardEvent, type ReactNode } from 'react';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { cx } from '@signalco/ui-primitives/cx';
import { Drag } from '@signalco/ui-icons';
import { readPreference, savePreference, useReviewDrag, useReviewViewport } from '../hooks/useReviewMovement';
import { useAnnounce } from './Announcer';
import { useMessages } from '../i18n';

export type PanelSide = 'left' | 'right';
type Side = PanelSide;
const isSide = (value: unknown): value is Side => value === 'left' || value === 'right';

/** Docked beside the page from 640px; wider from 1280px, where the page has the room */
export function panelWidth(viewWidth: number) {
    return viewWidth >= 1280 ? 400 : viewWidth >= 640 ? 320 : Math.max(0, viewWidth - 32);
}

/** Two panels, one on each side, where both fit beside each other with their margins (688px and wider) */
export function panelsSideBySide(viewWidth: number) {
    return viewWidth >= 640 && 2 * panelWidth(viewWidth) + 48 <= viewWidth;
}

function subscribeViewport(listener: () => void) {
    window.addEventListener('resize', listener);
    window.visualViewport?.addEventListener('resize', listener);
    return () => {
        window.removeEventListener('resize', listener);
        window.visualViewport?.removeEventListener('resize', listener);
    };
}
export const panelsSideBySideNow = () => panelsSideBySide(window.visualViewport?.width ?? window.innerWidth);
/** Whether two panels fit side by side now: changes only when that does, not with every resize */
export function usePanelsSideBySide() {
    return useSyncExternalStore(subscribeViewport, panelsSideBySideNow);
}

// The side each panel docks on (a browser-local preference), shared: whether two panels can be open
// together depends on their sides (`fitPanels` in openPanel.ts)
const sideKey = (id: string) => `uier:panel-side:v1:${id}`;
const sides = new Map<string, Side>();
const sideListeners = new Set<() => void>();
let sidesVersion = 0;
export function panelSide(id: string): Side {
    let side = sides.get(id);
    if (!side) {
        side = readPreference(sideKey(id), isSide) ?? 'right';
        sides.set(id, side);
    }
    return side;
}
function setPanelSide(id: string, side: Side) {
    sides.set(id, side);
    savePreference(sideKey(id), side);
    sidesVersion += 1;
    sideListeners.forEach(listener => listener());
}
function subscribeSides(listener: () => void) {
    sideListeners.add(listener);
    return () => { sideListeners.delete(listener); };
}
/** Changes when a panel moves to the other side */
export function usePanelSidesVersion() {
    return useSyncExternalStore(subscribeSides, () => sidesVersion);
}
// The panels on the page now (id and label): one moved onto another's side swaps sides with it
const docked = new Map<string, string>();

const PanelHandleContext = createContext<ReactNode>(null);

/** The panel's drag handle (also left and right arrow keys), for the panel's own header */
export function PanelHandle() {
    return useContext(PanelHandleContext);
}

/**
 * Shared docking shell: changing sides never remounts the panel's content or loses its scroll/drafts.
 * Moved onto the side of another open panel, the two swap sides, so both stay open.
 */
export function DockablePanel({ id, label, children, className, onKeyDown }: PropsWithChildren<{
    id: string; label: string; className?: string; onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
}>) {
    usePanelSidesVersion();
    const side = panelSide(id);
    const [destination, setDestination] = useState<Side>();
    const target = useRef<Side>(side);
    const view = useReviewViewport();
    const announce = useAnnounce();
    const t = useMessages();
    const wide = view.width >= 640;
    const width = panelWidth(view.width);
    useEffect(() => {
        docked.set(id, label);
        return () => { docked.delete(id); };
    }, [id, label]);
    const moveTo = (next: Side) => {
        const other: Side = next === 'left' ? 'right' : 'left';
        const swapped = next === side ? [] : [...docked].filter(([panel]) => panel !== id && panelSide(panel) === next);
        setPanelSide(id, next);
        swapped.forEach(([panel]) => setPanelSide(panel, other));
        announce([t.panel.moved(label, next), ...swapped.map(([, name]) => t.panel.moved(name, other))].join(' '));
    };
    const drag = useReviewDrag({
        onStart: () => { target.current = side; setDestination(side); },
        onMove: point => { target.current = point.x < view.left + view.width / 2 ? 'left' : 'right'; setDestination(target.current); },
        onEnd: canceled => { setDestination(undefined); if (!canceled) moveTo(target.current); }
    });
    const handle = (
        <IconButton variant="plain" size="sm" aria-label={t.panel.move(label)}
            title={t.panel.moveTip} className="-ml-2 shrink-0" {...drag.handle}
            onKeyDown={event => {
                drag.handle.onKeyDown(event);
                if (event.defaultPrevented) return;
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home') {
                    event.preventDefault(); moveTo(event.key === 'ArrowLeft' ? 'left' : 'right');
                }
            }}><Drag /></IconButton>
    );
    return (
        <>
            {drag.dragging && destination && (
                <div aria-hidden="true" className="pointer-events-none fixed z-[52] rounded-2xl border-2 border-ring bg-muted/40"
                    style={{ top: view.top + 8, left: view.left + (destination === 'left' ? 8 : view.width / 2), width: view.width / 2 - 8, height: view.height - 16 }}>
                    <p className="m-4 rounded-md bg-background p-2 text-sm text-foreground">{t.panel.moveTo(destination)}</p>
                </div>
            )}
            <aside id={`uier-panel-${id}`} aria-label={label} data-uier-panel={id} data-side={side} onKeyDown={onKeyDown}
                className={cx('fixed z-50 flex flex-col rounded-2xl border bg-background text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.16)]', className)}
                style={{ top: view.top + 16, left: view.left + (wide && side === 'right' ? view.width - width - 16 : 16), width, height: Math.max(0, view.height - (wide ? 32 : 96)) }}>
                <PanelHandleContext value={handle}>
                    <div className="min-h-0 flex-1">{children}</div>
                </PanelHandleContext>
            </aside>
        </>
    );
}
