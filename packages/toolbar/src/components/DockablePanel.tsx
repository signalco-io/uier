import { createContext, useContext, useRef, useState, type PropsWithChildren, type KeyboardEvent, type ReactNode } from 'react';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { cx } from '@signalco/ui-primitives/cx';
import { Drag } from '@signalco/ui-icons';
import { readPreference, savePreference, useReviewDrag, useReviewViewport } from '../hooks/useReviewMovement';
import { useAnnounce } from './Announcer';

type Side = 'left' | 'right';
const isSide = (value: unknown): value is Side => value === 'left' || value === 'right';

/** Docked beside the page from 640px; wider from 1280px, where the page has the room */
export function panelWidth(viewWidth: number) {
    return viewWidth >= 1280 ? 400 : viewWidth >= 640 ? 320 : Math.max(0, viewWidth - 32);
}

const PanelHandleContext = createContext<ReactNode>(null);

/** The panel's drag handle (also left and right arrow keys), for the panel's own header */
export function PanelHandle() {
    return useContext(PanelHandleContext);
}

/** Shared docking shell: changing sides never remounts the panel's content or loses its scroll/drafts. */
export function DockablePanel({ id, label, children, className, onKeyDown }: PropsWithChildren<{
    id: string; label: string; className?: string; onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
}>) {
    const key = `uier:panel-side:v1:${id}`;
    const [side, setSide] = useState<Side>(() => readPreference(key, isSide) ?? 'right');
    const [destination, setDestination] = useState<Side>();
    const target = useRef<Side>(side);
    const view = useReviewViewport();
    const announce = useAnnounce();
    const wide = view.width >= 640;
    const width = panelWidth(view.width);
    const moveTo = (next: Side) => { setSide(next); savePreference(key, next); announce(`${label} moved to the ${next}.`); };
    const drag = useReviewDrag({
        onStart: () => { target.current = side; setDestination(side); },
        onMove: point => { target.current = point.x < view.left + view.width / 2 ? 'left' : 'right'; setDestination(target.current); },
        onEnd: canceled => { setDestination(undefined); if (!canceled) moveTo(target.current); }
    });
    const handle = (
        <IconButton variant="plain" size="sm" aria-label={`Move ${label.toLowerCase()} panel`}
            title="Drag to the other side, or use the arrow keys" className="-ml-2 shrink-0" {...drag.handle}
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
                    <p className="m-4 rounded-md bg-background p-2 text-sm text-foreground">Move to the {destination}</p>
                </div>
            )}
            <aside aria-label={label} data-uier-panel={id} data-side={side} onKeyDown={onKeyDown}
                className={cx('fixed z-50 flex flex-col rounded-2xl border bg-background text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.16)]', className)}
                style={{ top: view.top + 16, left: view.left + (wide && side === 'right' ? view.width - width - 16 : 16), width, height: Math.max(0, view.height - (wide ? 32 : 96)) }}>
                <PanelHandleContext value={handle}>
                    <div className="min-h-0 flex-1">{children}</div>
                </PanelHandleContext>
            </aside>
        </>
    );
}
