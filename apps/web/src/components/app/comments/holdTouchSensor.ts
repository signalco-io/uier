import type { TouchEvent as ReactTouchEvent } from 'react';
import type { Activators, SensorInstance, SensorProps } from '@dnd-kit/core';

type Coordinates = { x: number; y: number };

export type HoldTouchSensorOptions = {
    /** How long the finger is held still before a move lifts the card; a move before it scrolls the page */
    delay: number;
    /** How far the finger may move while it is held; past it, a held press lifts the card */
    tolerance: number;
    /** Held still this long, the press is not a drag: it is a long press (it selects the card), and a later move drags nothing */
    longPress: number;
};

function coordinates(event: Event): Coordinates | undefined {
    if (event instanceof PointerEvent) return { x: event.clientX, y: event.clientY };
    const touch = (event as TouchEvent).touches?.[0] ?? (event as TouchEvent).changedTouches?.[0];
    return touch && { x: touch.clientX, y: touch.clientY };
}
const preventDefault = (event: Event) => event.preventDefault();
const stopPropagation = (event: Event) => event.stopPropagation();

/**
 * dnd-kit's touch sensor, except that holding the finger still does not lift the card: after the hold (`delay`) it is
 * armed (`data-hold` on the card), and a move then lifts it and drags it. Held still until `longPress`, the press is
 * the person's long press (TriageSelection selects the card) and the sensor lets go. A move within the hold scrolls.
 */
export class HoldTouchSensor implements SensorInstance {
    static activators: Activators<HoldTouchSensorOptions> = [{
        eventName: 'onTouchStart',
        handler: ({ nativeEvent }: ReactTouchEvent) => nativeEvent.touches.length <= 1
    }];

    /** A non-passive `touchmove` listener on the window lets the sensor's own listener prevent scrolling (iOS Safari) */
    static setup() {
        const noop = () => {};
        window.addEventListener('touchmove', noop, { passive: false });
        return () => window.removeEventListener('touchmove', noop);
    }

    autoScrollEnabled = true;
    private readonly props: SensorProps<HoldTouchSensorOptions>;
    private readonly target: EventTarget;
    private readonly origin: Coordinates;
    private readonly node: HTMLElement | null;
    private phase: 'pending' | 'armed' | 'dragging' = 'pending';
    private readonly timers: number[] = [];

    constructor(props: SensorProps<HoldTouchSensorOptions>) {
        this.props = props;
        const { event, options } = props;
        this.target = event.target ?? window;
        this.origin = coordinates(event) ?? { x: 0, y: 0 };
        this.node = props.activeNode.node.current;
        // Pointer moves follow the finger from the first pixel (the browser holds back touch moves within its slop);
        // touch moves are where scrolling is prevented
        document.addEventListener('pointermove', this.pointerMove);
        this.target.addEventListener('touchmove', this.move, { passive: false });
        this.target.addEventListener('touchend', this.end);
        this.target.addEventListener('touchcancel', this.cancel);
        window.addEventListener('resize', this.cancel);
        window.addEventListener('dragstart', preventDefault);
        window.addEventListener('visibilitychange', this.cancel);
        window.addEventListener('contextmenu', preventDefault);
        document.addEventListener('keydown', this.keydown);
        this.timers.push(window.setTimeout(this.arm, options.delay), window.setTimeout(this.cancel, options.longPress));
        props.onPending(props.active, { delay: options.delay, tolerance: options.tolerance }, this.origin);
    }

    private readonly arm = () => {
        if (this.phase !== 'pending') return;
        this.phase = 'armed';
        this.node?.setAttribute('data-hold', '');
    };

    private readonly pointerMove = (event: PointerEvent) => {
        if (event.pointerType === 'touch' && event.isPrimary) this.move(event);
    };

    private readonly move = (event: Event) => {
        const at = coordinates(event);
        if (!at) return;
        if (this.phase === 'dragging') {
            if (event.cancelable) event.preventDefault();
            this.props.onMove(at);
            return;
        }
        const moved = Math.hypot(at.x - this.origin.x, at.y - this.origin.y) > this.props.options.tolerance;
        // Held, the finger no longer scrolls the page: it drags once it moves
        if (this.phase === 'armed' && event.cancelable) event.preventDefault();
        if (!moved) return;
        if (this.phase === 'pending') return this.cancel();
        this.start();
        this.props.onMove(at);
    };

    private start() {
        this.phase = 'dragging';
        this.clearTimers();
        this.node?.removeAttribute('data-hold');
        // The press that dragged ends in no click, and selects no text while it drags
        document.addEventListener('click', stopPropagation, { capture: true });
        document.getSelection()?.removeAllRanges();
        document.addEventListener('selectionchange', this.clearSelection);
        this.props.onStart(this.origin);
    }

    private readonly clearSelection = () => document.getSelection()?.removeAllRanges();

    private readonly keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') this.cancel(); };

    private readonly end = () => {
        const dragging = this.detach();
        if (!dragging) this.props.onAbort(this.props.active);
        this.props.onEnd();
    };

    private readonly cancel = () => {
        const dragging = this.detach();
        if (!dragging) this.props.onAbort(this.props.active);
        this.props.onCancel();
    };

    private clearTimers() {
        for (const timer of this.timers.splice(0)) window.clearTimeout(timer);
    }

    /** Lets go of the press; whether it was dragging */
    private detach() {
        const dragging = this.phase === 'dragging';
        this.clearTimers();
        this.node?.removeAttribute('data-hold');
        document.removeEventListener('pointermove', this.pointerMove);
        this.target.removeEventListener('touchmove', this.move);
        this.target.removeEventListener('touchend', this.end);
        this.target.removeEventListener('touchcancel', this.cancel);
        window.removeEventListener('resize', this.cancel);
        window.removeEventListener('dragstart', preventDefault);
        window.removeEventListener('visibilitychange', this.cancel);
        window.removeEventListener('contextmenu', preventDefault);
        // The click that follows the lifted finger comes after this
        window.setTimeout(() => {
            document.removeEventListener('keydown', this.keydown);
            document.removeEventListener('click', stopPropagation, { capture: true });
            document.removeEventListener('selectionchange', this.clearSelection);
        }, 50);
        return dragging;
    }
}
