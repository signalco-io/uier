import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type PropsWithChildren, type KeyboardEvent, type ReactNode } from 'react';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { cx } from '@signalco/ui-primitives/cx';
import { Drag } from '@signalco/ui-icons';
import { readPreference, savePreference, useReviewDrag, useReviewViewport } from '../hooks/useReviewMovement';
import { useAnnounce } from './Announcer';
import { useMessages } from '../i18n';

export type PanelSide = 'left' | 'right';
type DockPart = 'full' | 'top' | 'bottom';
/** Where a panel docks: a whole side, or a quarter of the page (the top or bottom half of a side) */
export type PanelDock = PanelSide | `${PanelSide}-${'top' | 'bottom'}`;
const panelDocks: readonly PanelDock[] = ['left', 'right', 'left-top', 'right-top', 'left-bottom', 'right-bottom'];
const isDock = (value: unknown): value is PanelDock => panelDocks.includes(value as PanelDock);
export const dockSide = (dock: PanelDock): PanelSide => dock.startsWith('left') ? 'left' : 'right';
export const dockPart = (dock: PanelDock): DockPart => dock.endsWith('-top') ? 'top' : dock.endsWith('-bottom') ? 'bottom' : 'full';
const toDock = (side: PanelSide, part: DockPart): PanelDock => part === 'full' ? side : `${side}-${part}`;
const otherSide = (side: PanelSide): PanelSide => side === 'left' ? 'right' : 'left';

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
/**
 * The room the docked panels have: 0 narrower than 640px (one panel covers the page), 1 where two do not
 * fit side by side (one column: a top and a bottom quarter still fit), 2 where both sides do
 */
export type PanelRoom = 0 | 1 | 2;
export function panelRoom(viewWidth: number): PanelRoom {
    return viewWidth < 640 ? 0 : panelsSideBySide(viewWidth) ? 2 : 1;
}
export const panelRoomNow = () => panelRoom(window.visualViewport?.width ?? window.innerWidth);
/** The panels' room now: changes only when that does, not with every resize */
export function usePanelRoom() {
    return useSyncExternalStore(subscribeViewport, panelRoomNow);
}

/** Whether two panels docked here would cover each other: the same side (or one column) and the same half or a whole side */
export function docksOverlap(a: PanelDock, b: PanelDock, room: PanelRoom) {
    if (room === 0) return true;
    if (room === 2 && dockSide(a) !== dockSide(b)) return false;
    return dockPart(a) === 'full' || dockPart(b) === 'full' || dockPart(a) === dockPart(b);
}

// Where each panel docks (a browser-local preference), shared: whether panels can be open together
// depends on where they are (`fitPanels` in openPanel.ts). The key predates the quarters: "left" and
// "right" are still whole sides.
const sideKey = (id: string) => `uier:panel-side:v1:${id}`;
const sides = new Map<string, PanelDock>();
const sideListeners = new Set<() => void>();
let sidesVersion = 0;
export function panelDock(id: string): PanelDock {
    let dock = sides.get(id);
    if (!dock) {
        dock = readPreference(sideKey(id), isDock) ?? 'right';
        sides.set(id, dock);
    }
    return dock;
}
function setPanelDock(id: string, dock: PanelDock) {
    sides.set(id, dock);
    savePreference(sideKey(id), dock);
    sidesVersion += 1;
    sideListeners.forEach(listener => listener());
}
function subscribeSides(listener: () => void) {
    sideListeners.add(listener);
    return () => { sideListeners.delete(listener); };
}
/** Changes when a panel moves */
export function usePanelSidesVersion() {
    return useSyncExternalStore(subscribeSides, () => sidesVersion);
}
// The panels on the page now (id and label): one moved onto another's place swaps places with it
const docked = new Map<string, string>();

type Box = { top: number; left: number; width: number; height: number };
/** A docked panel's box: 16px from the viewport's edges and 16px apart; narrower than 640px it covers the page */
function dockBox(dock: PanelDock, view: Box, width: number): Box {
    if (view.width < 640) return { top: view.top + 16, left: view.left + 16, width, height: Math.max(0, view.height - 96) };
    const part = dockPart(dock);
    const half = Math.max(0, (view.height - 48) / 2);
    return {
        top: view.top + 16 + (part === 'bottom' ? half + 16 : 0),
        left: view.left + (dockSide(dock) === 'right' ? view.width - width - 16 : 16),
        width,
        height: part === 'full' ? Math.max(0, view.height - 32) : half
    };
}

/**
 * Where the panels that `dock` would cover go when a panel moves there from `from`: one takes its
 * place, several go to its side keeping their half (else across), never onto another panel. One with
 * nowhere to go stays and closes (`fitPanels`).
 */
function displace(id: string, from: PanelDock, dock: PanelDock, room: PanelRoom): [string, PanelDock][] {
    const others = [...docked.keys()].filter(panel => panel !== id);
    const covered = others.filter(panel => docksOverlap(panelDock(panel), dock, room));
    const taken: PanelDock[] = [dock, ...others.filter(panel => !covered.includes(panel)).map(panelDock)];
    const moves: [string, PanelDock][] = [];
    for (const panel of covered) {
        const part = dockPart(panelDock(panel));
        const candidates = [...(covered.length === 1 ? [from] : []), toDock(dockSide(from), part), toDock(otherSide(dockSide(dock)), part)];
        const next = candidates.find(candidate => taken.every(other => !docksOverlap(candidate, other, room)));
        if (!next) continue;
        taken.push(next);
        moves.push([panel, next]);
    }
    return moves;
}

/** Where a panel dragged with its centre at `point` docks: the side the centre is on; its top or bottom third a quarter */
function dockAt(point: { x: number; y: number }, view: Box): PanelDock {
    const side = point.x < view.left + view.width / 2 ? 'left' : 'right';
    const y = (point.y - view.top) / view.height;
    return toDock(side, y < 1 / 3 ? 'top' : y > 2 / 3 ? 'bottom' : 'full');
}

const PanelHandleContext = createContext<ReactNode>(null);

/** The panel's drag handle (also the arrow keys), for the panel's own header */
export function PanelHandle() {
    return useContext(PanelHandleContext);
}

/**
 * Shared docking shell: a whole side or a quarter (`PanelDock`). Moving never remounts the panel's
 * content or loses its scroll/drafts. Moved onto the place of another open panel, they swap places,
 * so both stay open.
 */
export function DockablePanel({ id, label, children, className, onKeyDown }: PropsWithChildren<{
    id: string; label: string; className?: string; onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
}>) {
    usePanelSidesVersion();
    const dock = panelDock(id);
    const [destination, setDestination] = useState<PanelDock>();
    const target = useRef<PanelDock>(dock);
    const start = useRef({ x: 0, y: 0 });
    const view = useReviewViewport();
    const announce = useAnnounce();
    const t = useMessages();
    const width = panelWidth(view.width);
    const box = dockBox(dock, view, width);
    useEffect(() => {
        docked.set(id, label);
        return () => { docked.delete(id); };
    }, [id, label]);
    const moveTo = (next: PanelDock) => {
        const moves = next === dock ? [] : displace(id, dock, next, panelRoom(view.width));
        if (next !== dock) setPanelDock(id, next);
        moves.forEach(([panel, to]) => setPanelDock(panel, to));
        announce([t.panel.moved(label, next), ...moves.map(([panel, to]) => t.panel.moved(docked.get(panel) ?? panel, to))].join(' '));
    };
    // The panel's centre follows the pointer: the place it is over is where it docks, so a drag that
    // ends where it started leaves the panel there
    const drag = useReviewDrag({
        onStart: () => {
            start.current = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
            target.current = dock;
            setDestination(dock);
        },
        onMove: (_, delta) => {
            target.current = dockAt({ x: start.current.x + delta.x, y: start.current.y + delta.y }, view);
            setDestination(target.current);
        },
        onEnd: canceled => { setDestination(undefined); if (!canceled) moveTo(target.current); }
    });
    // Left and right change the side; up and down go from the whole side to its top or bottom quarter and back
    const keyDock = (key: string): PanelDock | undefined => {
        const side = dockSide(dock), part = dockPart(dock);
        if (key === 'ArrowLeft' || key === 'ArrowRight') return toDock(key === 'ArrowLeft' ? 'left' : 'right', part);
        if (key === 'ArrowUp') return toDock(side, part === 'bottom' ? 'full' : 'top');
        if (key === 'ArrowDown') return toDock(side, part === 'top' ? 'full' : 'bottom');
        if (key === 'Home') return 'right';
        return undefined;
    };
    const handle = (
        <IconButton variant="plain" size="sm" aria-label={t.panel.move(label)}
            title={t.panel.moveTip} className="-ml-2 shrink-0" {...drag.handle}
            onKeyDown={event => {
                drag.handle.onKeyDown(event);
                if (event.defaultPrevented) return;
                const next = keyDock(event.key);
                if (next) { event.preventDefault(); moveTo(next); }
            }}><Drag /></IconButton>
    );
    const zone = destination && {
        top: view.top + 8 + (dockPart(destination) === 'bottom' ? (view.height - 16) / 2 + 4 : 0),
        left: view.left + (dockSide(destination) === 'left' ? 8 : view.width / 2),
        width: view.width / 2 - 8,
        height: dockPart(destination) === 'full' ? view.height - 16 : (view.height - 24) / 2
    };
    return (
        <>
            {drag.dragging && destination && zone && (
                <div aria-hidden="true" data-uier-panel-dock-zone={destination}
                    className="pointer-events-none fixed z-[52] rounded-2xl border-2 border-ring bg-muted/40" style={zone}>
                    <p className="m-4 rounded-md bg-background p-2 text-sm text-foreground">{t.panel.moveTo(destination)}</p>
                </div>
            )}
            <aside id={`uier-panel-${id}`} aria-label={label} data-uier-panel={id} data-side={dockSide(dock)} data-dock={dock} onKeyDown={onKeyDown}
                className={cx('fixed z-50 flex flex-col rounded-2xl border bg-background text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.16)]', className)}
                style={box}>
                <PanelHandleContext value={handle}>
                    <div className="min-h-0 flex-1">{children}</div>
                </PanelHandleContext>
            </aside>
        </>
    );
}
