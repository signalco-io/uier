import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type MouseEvent, type KeyboardEvent, type RefObject } from 'react';

export type Point = { x: number; y: number };
const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), Math.max(min, max));

export function readPreference<T>(key: string, valid: (value: unknown) => value is T): T | undefined {
    try {
        const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
        return valid(value) ? value : undefined;
    } catch { return undefined; }
}

export function savePreference(key: string, value: unknown) {
    try {
        if (value === undefined) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(value));
    } catch { /* Movement still works when storage is unavailable. */ }
}

function viewport() {
    const view = window.visualViewport;
    return { left: view?.offsetLeft ?? 0, top: view?.offsetTop ?? 0, width: view?.width ?? window.innerWidth, height: view?.height ?? window.innerHeight };
}

/** Includes the visible space left by zoom and the on-screen keyboard. */
export function useReviewViewport() {
    const [view, setView] = useState(viewport);
    useLayoutEffect(() => {
        const update = () => setView(viewport());
        window.addEventListener('resize', update);
        window.visualViewport?.addEventListener('resize', update);
        window.visualViewport?.addEventListener('scroll', update);
        return () => {
            window.removeEventListener('resize', update);
            window.visualViewport?.removeEventListener('resize', update);
            window.visualViewport?.removeEventListener('scroll', update);
        };
    }, []);
    return view;
}

/** One dedicated handle: pointer capture supports mouse/touch without touching page scrolling. */
export function useReviewDrag(callbacks: {
    onStart: () => void;
    onMove: (point: Point, delta: Point) => void;
    onEnd: (canceled: boolean) => void;
}) {
    const gesture = useRef<{ id: number; start: Point; moved: boolean }>(undefined);
    const dragged = useRef(false);
    const [dragging, setDragging] = useState(false);
    const cancel = useEffectEvent(() => {
        if (gesture.current?.moved) callbacks.onEnd(true);
        gesture.current = undefined;
        setDragging(false);
    });
    useEffect(() => {
        const onBlur = () => cancel();
        window.addEventListener('blur', onBlur);
        return () => window.removeEventListener('blur', onBlur);
    }, []);

    const finish = (event: PointerEvent<HTMLElement>, canceled: boolean) => {
        if (gesture.current?.id !== event.pointerId) return;
        const moved = gesture.current.moved;
        gesture.current = undefined;
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (moved) {
            callbacks.onEnd(canceled);
            dragged.current = true;
            setTimeout(() => { dragged.current = false; }, 0);
        }
    };

    return {
        dragging,
        /** True for the click that ends a drag; a handle that is also a button skips its action then. */
        wasDragged: () => dragged.current,
        handle: {
            style: { touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab' } as CSSProperties,
            onPointerDown: (event: PointerEvent<HTMLElement>) => {
                if (!event.isPrimary || event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.focus();
                gesture.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, moved: false };
                event.currentTarget.setPointerCapture(event.pointerId);
            },
            onPointerMove: (event: PointerEvent<HTMLElement>) => {
                const current = gesture.current;
                if (!current || current.id !== event.pointerId) return;
                const delta = { x: event.clientX - current.start.x, y: event.clientY - current.start.y };
                if (!current.moved && Math.hypot(delta.x, delta.y) < 5) return;
                if (!current.moved) { current.moved = true; callbacks.onStart(); setDragging(true); }
                callbacks.onMove({ x: event.clientX, y: event.clientY }, delta);
            },
            onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event, false),
            onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event, true),
            onLostPointerCapture: (event: PointerEvent<HTMLElement>) => finish(event, true),
            onClick: (event: MouseEvent<HTMLElement>) => event.preventDefault(),
            onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
                if (event.key !== 'Escape' || !gesture.current) return;
                event.preventDefault();
                event.stopPropagation();
                const moved = gesture.current.moved;
                gesture.current = undefined;
                setDragging(false);
                if (moved) callbacks.onEnd(true);
            },
        }
    };
}

const positionKey = 'uier:toolbar-position:v1';
function isPosition(value: unknown): value is Point {
    if (!value || typeof value !== 'object') return false;
    const { x, y } = value as Point;
    return Number.isFinite(x) && x >= 0 && x <= 1 && Number.isFinite(y) && y >= 0 && y <= 1;
}

export function useToolbarMovement(ref: RefObject<HTMLElement | null>, onStart?: () => void) {
    const view = useReviewViewport();
    const [position, setPosition] = useState(() => readPreference(positionKey, isPosition));
    const latest = useRef(position);
    const [size, setSize] = useState({ width: 0, height: 0 });
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;
        const measure = () => {
            const { width, height } = element.getBoundingClientRect();
            setSize(old => old.width === width && old.height === height ? old : { width, height });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);
    const left = clamp(view.left + (position?.x ?? 0.5) * view.width - size.width / 2, view.left + 16, view.left + view.width - size.width - 16);
    const top = clamp(position ? view.top + position.y * view.height - size.height / 2 : view.top + view.height - size.height - 16, view.top + 16, view.top + view.height - size.height - 16);
    const origin = useRef({ left, top, position });
    const update = (next: Point | undefined, persist = false) => {
        latest.current = next;
        setPosition(next);
        if (persist) savePreference(positionKey, next);
    };
    const move = (x: number, y: number, persist = false) => update({
        x: (clamp(x, view.left + 16, view.left + view.width - size.width - 16) + size.width / 2 - view.left) / view.width,
        y: (clamp(y, view.top + 16, view.top + view.height - size.height - 16) + size.height / 2 - view.top) / view.height
    }, persist);
    const drag = useReviewDrag({
        onStart: () => { origin.current = { left, top, position }; onStart?.(); },
        onMove: (_, delta) => move(origin.current.left + delta.x, origin.current.top + delta.y),
        onEnd: canceled => canceled ? update(origin.current.position) : savePreference(positionKey, latest.current)
    });
    const reset = () => update(undefined, true);
    return {
        ...drag,
        custom: Boolean(position), reset,
        style: { left, top, maxWidth: Math.max(0, view.width - 32), padding: 'env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px)' } as CSSProperties,
        instructionStyle: { left: view.left + view.width / 2, top: top > view.top + 64 ? top - 44 : top + size.height + 8 } as CSSProperties,
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
            drag.handle.onKeyDown(event);
            if (event.defaultPrevented) return;
            if (event.key === 'Home') { event.preventDefault(); reset(); return; }
            const distance = event.shiftKey ? 40 : 10;
            const deltas: Record<string, Point> = { ArrowLeft: { x: -distance, y: 0 }, ArrowRight: { x: distance, y: 0 }, ArrowUp: { x: 0, y: -distance }, ArrowDown: { x: 0, y: distance } };
            const delta = deltas[event.key];
            if (delta) { event.preventDefault(); onStart?.(); move(left + delta.x, top + delta.y, true); }
        }
    };
}
