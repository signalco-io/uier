import { useId, useLayoutEffect, useSyncExternalStore } from 'react';

/**
 * Pins that would overlap (comments on the same element, or on elements close together) move apart
 * just enough that each is visible and can be pressed (uier #367). Every pin reports where it would
 * be by itself; the page's pins are placed one by one, the oldest first, so a new pin never moves the
 * ones already there: a pin that would overlap a placed one goes beside it (right, else left), or to
 * the next row below (above an upside-down pin) when the row has grown long or reaches the window's edge.
 */

/** A pin where it would be by itself: its middle, how far it reaches each way, and the window it is kept in */
export type PinBox = {
    /** The pin's middle, by itself */
    x: number;
    y: number;
    /** How far it reaches left and right of its middle: its hit area, the count badge and the people beside it */
    left: number;
    right: number;
    /** Half its height (its hit area) */
    half: number;
    /** Which pin keeps its place: the lower first (the comment's number; drafts last) */
    order: number;
    upsideDown: boolean;
    /** Where its middle may be in the window (as `bubbleLeft` keeps it) */
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
};

/** How far a pin moved from where it would be by itself */
export type PinShift = { dx: number; dy: number };

/** The space kept between pins */
export const pinGap = 4;
/** At most this many rows past the pin's own, then it stays where it is */
const maxRows = 4;
/**
 * Moving left, or to another row, counts this much more than moving right, so pins stay in their row
 * while it is close; a row above a pin (below an upside-down one) counts more again
 */
const leftCost = 1.5;
const rowCost = 2.5;
const backRowCost = 1.5;

const noShift: PinShift = { dx: 0, dy: 0 };

type Placed = { box: PinBox; x: number; y: number };

function collides(box: PinBox, x: number, y: number, other: Placed) {
    return x - box.left < other.x + other.box.right + pinGap
        && other.x - other.box.left < x + box.right + pinGap
        && Math.abs(y - other.y) < box.half + other.box.half + pinGap;
}

/** The nearest free place in a row from `x`, going right (1) or left (-1); none past the window */
function sweep(box: PinBox, placed: Placed[], y: number, direction: 1 | -1, bounded: boolean) {
    let x = box.x;
    // Each step goes past at least one placed pin, so this ends
    for (let step = 0; step <= placed.length; step++) {
        let next: number | undefined;
        for (const other of placed) {
            if (!collides(box, x, y, other)) continue;
            const past = direction > 0
                ? other.x + other.box.right + pinGap + box.left
                : other.x - other.box.left - pinGap - box.right;
            next = next === undefined ? past : direction > 0 ? Math.max(next, past) : Math.min(next, past);
        }
        if (next === undefined) return x;
        x = next;
        if (bounded && (x > box.maxX || x < box.minX)) return undefined;
    }
    return undefined;
}

function cost(dx: number, dy: number, back: boolean) {
    return (dx >= 0 ? dx : -dx * leftCost) + Math.abs(dy) * rowCost * (back ? backRowCost : 1);
}

/**
 * Where each pin goes so none overlaps another, as shifts from where it would be by itself: unchanged
 * for a pin with room, the least move otherwise. Pins are placed by `order`, so one only moves for
 * the pins before it.
 */
export function spreadPins(pins: ReadonlyMap<string, PinBox>): Map<string, PinShift> {
    const shifts = new Map<string, PinShift>();
    const placed: Placed[] = [];
    const sorted = [...pins].sort(([aKey, a], [bKey, b]) => a.order - b.order || (aKey < bKey ? -1 : aKey > bKey ? 1 : 0));
    for (const [key, box] of sorted) {
        // Rows that could be closer than what was found, near enough to matter
        const near = placed.filter(other => Math.abs(other.y - box.y) < (maxRows + 1) * (box.half * 2 + pinGap) + other.box.half);
        let best: PinShift | undefined;
        if (!near.some(other => collides(box, box.x, box.y, other))) {
            best = noShift;
        } else {
            // Kept in the window, unless it is outside it by itself (an anchor scrolled away, a window too narrow)
            const boundedX = box.x >= box.minX && box.x <= box.maxX;
            const boundedY = box.y >= box.minY && box.y <= box.maxY;
            const rowStep = box.half * 2 + pinGap;
            const direction = box.upsideDown ? -1 : 1;
            let bestCost = Infinity;
            for (let row = 0; row <= maxRows; row++) {
                for (const sign of row ? [direction, -direction] : [direction]) {
                    const dy = sign * row * rowStep;
                    const back = sign !== direction;
                    if (cost(0, dy, back) >= bestCost) continue;
                    const y = box.y + dy;
                    if (boundedY && (y < box.minY || y > box.maxY)) continue;
                    for (const side of [1, -1] as const) {
                        const x = sweep(box, near, y, side, boundedX);
                        if (x === undefined) continue;
                        const candidate = cost(x - box.x, dy, back);
                        if (candidate < bestCost) {
                            bestCost = candidate;
                            best = { dx: x - box.x, dy };
                        }
                    }
                }
            }
        }
        // No room anywhere near: where it is, as before
        const shift = best ?? noShift;
        shifts.set(key, shift);
        placed.push({ box, x: box.x + shift.dx, y: box.y + shift.dy });
    }
    return shifts;
}

function sameShift(a: PinShift, b: PinShift) {
    return Math.abs(a.dx - b.dx) < 0.5 && Math.abs(a.dy - b.dy) < 0.5;
}

/**
 * The page's pins: each reports where it would be by itself, and gets its shift. Recomputed once
 * after the pins that changed have reported (a microtask, before the browser paints); only pins whose
 * shift changed render again, so scrolling, which moves every pin alike, costs no second render.
 */
export class PinLayout {
    private pins = new Map<string, PinBox>();
    private shifts = new Map<string, PinShift>();
    private listeners = new Set<() => void>();
    private scheduled = false;

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    shift = (key: string) => this.shifts.get(key) ?? noShift;

    set(key: string, box: PinBox) {
        this.pins.set(key, box);
        this.schedule();
    }

    delete(key: string) {
        if (this.pins.delete(key)) this.schedule();
    }

    private schedule() {
        if (this.scheduled) return;
        this.scheduled = true;
        queueMicrotask(() => {
            this.scheduled = false;
            this.update();
        });
    }

    private update() {
        const next = spreadPins(this.pins);
        let changed = false;
        for (const [key, shift] of next) {
            const current = this.shifts.get(key) ?? noShift;
            if (sameShift(current, shift)) next.set(key, current);
            else changed = true;
        }
        for (const key of this.shifts.keys()) {
            if (!next.has(key)) changed = true;
        }
        this.shifts = next;
        if (changed) this.listeners.forEach(listener => listener());
    }
}

/** One layout for each mounted toolbar (its root element), so its comments' and drafts' pins share it */
const layouts = new WeakMap<object, PinLayout>();
const detachedRoot = {};

function pinLayoutFor(root: object | null | undefined) {
    const key = root ?? detachedRoot;
    let layout = layouts.get(key);
    if (!layout) {
        layout = new PinLayout();
        layouts.set(key, layout);
    }
    return layout;
}

/**
 * A pin's shift from where it would be by itself (`box`; none while it has no place on the page),
 * so it does not overlap the other pins of the toolbar mounted in `root`
 */
export function usePinShift(root: object | null | undefined, box: PinBox | undefined): PinShift {
    const layout = pinLayoutFor(root);
    const key = useId();
    const shift = useSyncExternalStore(layout.subscribe, () => layout.shift(key));
    const { x, y, left, right, half, order, upsideDown, minX, maxX, minY, maxY } = box ?? {};
    useLayoutEffect(() => {
        if (x === undefined) layout.delete(key);
        else layout.set(key, { x, y: y!, left: left!, right: right!, half: half!, order: order!, upsideDown: upsideDown!, minX: minX!, maxX: maxX!, minY: minY!, maxY: maxY! });
    }, [layout, key, x, y, left, right, half, order, upsideDown, minX, maxX, minY, maxY]);
    useLayoutEffect(() => () => layout.delete(key), [layout, key]);
    return box ? shift : noShift;
}
