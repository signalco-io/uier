'use client';

import { Component, type ReactNode, type RefObject } from 'react';

/** BRAND.md, "Motion": a card or row enters and leaves with a fade and an 8 px slide in 150 ms */
const enterMs = 150;
/** …and takes 200 ms to reach a new place, which can be a column or two away */
const moveMs = 200;
const easing = 'ease-out';
const slidePx = 8;
/**
 * More cards than this entering, leaving or changing column in one update (a bulk change, a refresh after
 * a long gap, a filter that swaps the list) snap into place: that many moving at once is noise, not news.
 */
export const motionLimit = 8;
/** Every animation this file starts carries this id, so other code can wait for it (`motionSettled`) */
const motionId = 'layout-motion';
const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
const focusables = 'a[href], button, input, select, textarea, [tabindex], [role="checkbox"]';

/** A box relative to the container's padding box, where its absolutely positioned children sit */
type Box = { x: number; y: number; width: number; height: number };
/** Where an item was before the update: its element, box, opacity and the list or column it was in */
type Placed = { element: HTMLElement; box: Box; group: Element | null; groupBox?: Box; opacity: number; inert: boolean };
type Running = { animation: Animation; group: Element | null; place: Box };

/** The container's padding box in the viewport; a box relative to it is where an absolute child goes */
function originOf(container: HTMLElement) {
    const rect = container.getBoundingClientRect();
    return { left: rect.left + container.clientLeft - container.scrollLeft, top: rect.top + container.clientTop - container.scrollTop };
}

function boxOf(element: Element, origin: { left: number; top: number }): Box {
    const rect = element.getBoundingClientRect();
    return { x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height };
}

const near = (a: Box, b: Box) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
const within = (box: Box, group: Box | undefined): Box => group ? { ...box, x: box.x - group.x, y: box.y - group.y } : box;

/** Resolves once the element's layout motion (if any) has finished, for code that scrolls to where it lands */
export function motionSettled(element: Element | null | undefined) {
    const animations = element?.getAnimations().filter(animation => animation.id === motionId) ?? [];
    return Promise.allSettled(animations.map(animation => animation.finished)).then(() => undefined);
}

/**
 * Animates the items of a list or board when its data changes: from realtime refreshes, optimistic
 * changes, drops, filters or search. An item that arrives fades and slides in, one that leaves fades out
 * where it was (a copy, as React has already removed it), and one that changes place (another column,
 * another priority) travels there from where it was, while the items around it slide to their new places
 * (FLIP, with the Web Animations API on `transform` and `opacity`).
 *
 * Items are the elements in `container` that carry the `item` data attribute; its value is the item's id,
 * so a card that React mounts again in another column is still the same card. Positions are read right
 * before React changes the page (`getSnapshotBeforeUpdate`, the one React API that runs then) and after.
 * An item keeps its place in its own list or column: when a whole column shifts (a phone's stacked board),
 * its cards shift with it, and only a card that changes list travels across.
 *
 * Nothing moves on the first render or for a view that is not shown, with reduced motion or in a hidden
 * tab, and an update with more than `motionLimit` arrivals, departures and column changes snaps into
 * place. `skip` leaves items to someone else (the board's dragged card, which dnd-kit settles from the
 * drop). Animations are interruptible: a new update starts from where an item is on screen.
 *
 * A moved item that had the keyboard focus keeps it: a card React mounts again in its new column gets it
 * back on the same control, without scrolling (React itself keeps it on a row it only moves). Copies of
 * leaving items are `inert` and hidden from assistive technology, so announcements stay as they were.
 */
export class LayoutMotion extends Component<{
    /** The positioned element (`relative`) that holds the items; copies of leaving items are put in it */
    container: RefObject<HTMLElement | null>;
    /** The data attribute that marks an item and holds its id, e.g. `data-board-card` */
    item: `data-${string}`;
    /** The ids of items someone else places at the moment, e.g. a dragged card; read once per update */
    skip?: () => ReadonlySet<string>;
    children: ReactNode;
}> {
    private running = new Map<HTMLElement, Running>();
    private copies = new Map<string, HTMLElement>();
    /** The control in an item that had the focus last, while the focus is in the container */
    private focus?: { element: HTMLElement; id: string; elementId: string; index: number };

    componentDidMount() {
        document.addEventListener('focusin', this.onFocusIn);
        document.addEventListener('focusout', this.onFocusOut);
    }

    componentWillUnmount() {
        document.removeEventListener('focusin', this.onFocusIn);
        document.removeEventListener('focusout', this.onFocusOut);
        for (const copy of this.copies.values()) copy.remove();
        this.copies.clear();
    }

    getSnapshotBeforeUpdate() {
        const container = this.props.container.current;
        if (!container?.checkVisibility()) return null;
        const origin = originOf(container);
        const groups = new Map<Element, Box>();
        const placed = new Map<string, Placed>();
        for (const element of this.items(container)) {
            const group = element.parentElement;
            if (group && !groups.has(group)) groups.set(group, boxOf(group, origin));
            placed.set(this.idOf(element), {
                element, group, groupBox: group ? groups.get(group) : undefined, box: boxOf(element, origin), inert: element.inert,
                // Partway through an entrance, it carries on from its current opacity
                opacity: this.running.has(element) ? Number(getComputedStyle(element).opacity) : 1
            });
        }
        return placed;
    }

    componentDidUpdate(_props: unknown, _state: unknown, before: Map<string, Placed> | null) {
        this.restoreFocus();
        const container = this.props.container.current;
        if (!before || !container) return;
        if (!container.checkVisibility() || document.visibilityState !== 'visible' || window.matchMedia(reducedMotionQuery).matches) {
            this.stopAll();
            return;
        }
        // Cards React mounted again elsewhere: their old elements are gone
        for (const [element, { animation }] of this.running) if (!element.isConnected) animation.cancel();
        const origin = originOf(container);
        const groups = new Map<Element, Box>();
        const skipped = this.props.skip?.() ?? new Set<string>();
        const skip = (id: string) => skipped.has(id);
        const now = this.items(container).map(element => {
            const group = element.parentElement;
            if (group && !groups.has(group)) groups.set(group, boxOf(group, origin));
            const box = boxOf(element, origin);
            // Where it is laid out: its box without the motion it is in the middle of
            if (this.running.has(element)) {
                const transform = new DOMMatrixReadOnly(getComputedStyle(element).transform);
                box.x -= transform.m41;
                box.y -= transform.m42;
            }
            return { id: this.idOf(element), element, group, groupBox: group ? groups.get(group) : undefined, box };
        });
        const ids = new Set(now.map(item => item.id));
        const entering = now.filter(item => !before.has(item.id) && !skip(item.id));
        // An item that was folding away by itself (inert, like a list row that Done takes out) needs no copy
        const leaving = [...before].filter(([id, placed]) => !ids.has(id) && !placed.inert && placed.box.height > 0 && placed.opacity > 0);
        const regrouped = now.filter(item => before.has(item.id) && before.get(item.id)!.group !== item.group && !skip(item.id));
        if (entering.length + leaving.length + regrouped.length > motionLimit) {
            this.stopAll();
            return;
        }

        for (const { id, element, group, groupBox, box } of now) {
            const running = this.running.get(element);
            if (skip(id)) {
                running?.animation.cancel();
                continue;
            }
            const first = before.get(id);
            if (!first) {
                // Back before its copy finished leaving
                this.copies.get(id)?.remove();
                this.animate(element, group, within(box, groupBox), 'enter', [
                    { opacity: 0, transform: `translateY(-${slidePx}px)` },
                    { opacity: 1, transform: 'none' }
                ], enterMs);
                continue;
            }
            // Already on its way to this place
            if (running && running.group === group && near(running.place, within(box, groupBox))) continue;
            // In the same list or column it keeps its place there, so it shifts with a column that shifts
            const from = first.group === group && first.groupBox && groupBox
                ? { x: first.box.x - first.groupBox.x + groupBox.x, y: first.box.y - first.groupBox.y + groupBox.y }
                : first.box;
            const dx = from.x - box.x;
            const dy = from.y - box.y;
            const moved = Math.abs(dx) >= 1 || Math.abs(dy) >= 1;
            if (!moved && first.opacity >= 1) {
                running?.animation.cancel();
                continue;
            }
            // One that crosses other items (another column, or more than a place away) passes over them
            const crosses = first.group !== group || Math.abs(dy) > box.height * 1.5 || Math.abs(dx) > box.width / 2;
            this.animate(element, group, within(box, groupBox), 'move', [
                { opacity: first.opacity, transform: `translate(${dx}px, ${dy}px)` },
                { opacity: 1, transform: 'none' }
            ], moved ? moveMs : enterMs, crosses);
        }
        for (const [id, placed] of leaving) this.leave(container, id, placed);
    }

    render() {
        return this.props.children;
    }

    private items(container: HTMLElement) {
        return [...container.querySelectorAll<HTMLElement>(`[${this.props.item}]`)];
    }

    private idOf(element: HTMLElement) {
        return element.getAttribute(this.props.item) ?? '';
    }

    private animate(element: HTMLElement, group: Element | null, place: Box, kind: 'enter' | 'move', keyframes: Keyframe[], duration: number, above = false) {
        this.running.get(element)?.animation.cancel();
        const animation = element.animate(keyframes, { duration, easing });
        animation.id = motionId;
        // Marks the motion while it plays (and for tests, which watch for it)
        element.dataset.motion = kind;
        // Items are flex items, so this lifts it above the other items and their controls (`z-10`)
        if (above) element.style.zIndex = '11';
        this.running.set(element, { animation, group, place });
        const done = () => {
            if (this.running.get(element)?.animation !== animation) return;
            this.running.delete(element);
            delete element.dataset.motion;
            element.style.zIndex = '';
        };
        animation.finished.then(done, done);
    }

    /** A copy of the item where it was, fading out with a slide up, then removed */
    private leave(container: HTMLElement, id: string, placed: Placed) {
        this.copies.get(id)?.remove();
        const copy = placed.element.cloneNode(true) as HTMLElement;
        copy.removeAttribute(this.props.item);
        for (const element of [copy, ...copy.querySelectorAll('[id]')]) element.removeAttribute('id');
        copy.dataset.motion = 'exit';
        copy.dataset.motionFor = id;
        copy.inert = true;
        copy.setAttribute('aria-hidden', 'true');
        Object.assign(copy.style, {
            position: 'absolute', left: `${placed.box.x}px`, top: `${placed.box.y}px`, width: `${placed.box.width}px`, height: `${placed.box.height}px`,
            margin: '0', listStyle: 'none', pointerEvents: 'none'
        });
        container.append(copy);
        this.copies.set(id, copy);
        const animation = copy.animate([
            { opacity: placed.opacity, transform: 'none' },
            { opacity: 0, transform: `translateY(-${slidePx}px)` }
        ], { duration: enterMs, easing, fill: 'forwards' });
        animation.id = motionId;
        const done = () => {
            copy.remove();
            if (this.copies.get(id) === copy) this.copies.delete(id);
        };
        animation.finished.then(done, done);
    }

    /** Everything to its place at once */
    private stopAll() {
        for (const { animation } of [...this.running.values()]) animation.cancel();
        for (const copy of this.copies.values()) copy.remove();
        this.copies.clear();
    }

    private onFocusIn = (event: FocusEvent) => {
        const container = this.props.container.current;
        const target = event.target;
        const item = target instanceof HTMLElement && container?.contains(target) ? target.closest<HTMLElement>(`[${this.props.item}]`) : null;
        this.focus = item && target instanceof HTMLElement
            ? { element: target, id: this.idOf(item), elementId: target.id, index: [...item.querySelectorAll(focusables)].indexOf(target) }
            : undefined;
    };

    /**
     * The focus left for nowhere: a click on the page, not an update. React's change of the page runs at
     * once, so by the next microtask a focus it took away is back (`restoreFocus`).
     */
    private onFocusOut = () => {
        queueMicrotask(() => {
            if (!document.activeElement || document.activeElement === document.body) this.focus = undefined;
        });
    };

    /** The control that had the focus before the update, back in its item, wherever that is now */
    private restoreFocus() {
        const focus = this.focus;
        const container = this.props.container.current;
        if (!focus || !container || (document.activeElement && document.activeElement !== document.body)) return;
        let target: HTMLElement | null | undefined = focus.element.isConnected && container.contains(focus.element) ? focus.element : undefined;
        if (!target) {
            const item = container.querySelector(`[${this.props.item}="${CSS.escape(focus.id)}"]`);
            // By its id, unless that was generated and is new; else by its place among the item's controls
            target = (focus.elementId ? item?.querySelector<HTMLElement>(`#${CSS.escape(focus.elementId)}`) : null)
                ?? item?.querySelectorAll<HTMLElement>(focusables)[focus.index];
        }
        if (target) target.focus({ preventScroll: true });
        else this.focus = undefined;
    }
}
