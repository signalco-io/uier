'use client';

import { useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { cx } from '@signalco/ui-primitives/cx';
import { drawingLimits, drawingText, isStyledShape, type DrawingShape, type DrawingStyle, type StyledShape, type TextShape } from '../../drawing';
import {
    boxBetween, finishFreehand, hitsShape, lineEnd, moveShape, newSeed, resizeShape, shapeAt, shapeBounds, shapeHandles, textMetrics,
    textFont, textWeight, type Handle, type Point
} from '../../canvas/geometry';
import { frameAt, frameOffset, scrollFrameBy, scrollTargetAt, type CanvasFrame } from '../../canvas/finish';
import { measureText } from '../../canvas/paint';
import { listenToWindowKeydown } from '../../modalLayer';
import { isLetterKeyTarget, useShortcutsEnabled } from '../../shortcuts';
import { shortcutLetter } from '../../keyboard';
import { useMessages } from '../../i18n';
import { useAnnounce } from '../Announcer';
import { CanvasPanel, canvasTools, toolKeys, type CanvasTool } from './CanvasPanel';
import { drawColor, DrawingLayer } from './DrawingLayer';

type CanvasModeProps = {
    /** The shapes to go on with (Edit drawing), in the page's coordinates */
    initialShapes?: DrawingShape[];
    onDiscard: () => void;
    /** Done drawing: `tooLarge` when the drawing can't be saved */
    onComment: (shapes: DrawingShape[], frame: CanvasFrame) => 'tooLarge' | 'empty' | void;
};

type Gesture =
    | { kind: 'draw'; pointerId: number; start: Point }
    | { kind: 'move'; pointerId: number; start: Point; original: DrawingShape }
    | { kind: 'resize'; pointerId: number; handle: Handle; original: DrawingShape }
    | { kind: 'erase'; pointerId: number }
    | { kind: 'pan'; middle: Point };

/** Editing a text note: a new one or the one with this id, in the frame's coordinates */
type TextEditing = { id: string; x: number; y: number; text: string; style: DrawingStyle; isNew: boolean };

const historyLimit = 100;
/** How far from a shape a press still picks it (a finger is less precise) */
const tolerance = (pointerType: string) => pointerType === 'touch' ? 12 : 6;
const handleRadius = 6;
/** A keyboard-added box, and how far the arrow keys move a shape */
const keyboardBox = { width: 160, height: 100 };

function newId() {
    return Math.random().toString(36).slice(2, 10);
}

function styleOf(shape: StyledShape): DrawingStyle {
    const { color, size, dash, fill, fillStyle, sketchy } = shape;
    return { color, size, ...(dash ? { dash } : {}), ...(fill ? { fill } : {}), ...(fillStyle ? { fillStyle } : {}), ...(sketchy ? { sketchy } : {}) };
}

/** The style with the change, without the settings that are off (a solid fill without a background) */
function withStyle(style: DrawingStyle, patch: Partial<DrawingStyle>): DrawingStyle {
    const next = { ...style, ...patch };
    const clean: DrawingStyle = { color: next.color, size: next.size };
    if (next.dash) clean.dash = next.dash;
    if (next.fill) clean.fill = next.fill;
    if (next.fill && next.fillStyle) clean.fillStyle = next.fillStyle;
    if (next.sketchy) clean.sketchy = true;
    return clean;
}

/** A shape restyled: a note takes only its colours and size, and is measured again */
function restyled(shape: StyledShape, style: DrawingStyle): StyledShape {
    const rest: Record<string, unknown> = { ...shape };
    for (const key of ['dash', 'fill', 'fillStyle', 'sketchy']) delete rest[key];
    if (shape.type === 'text') {
        const textStyle: DrawingStyle = { color: style.color, size: style.size, ...(style.fill ? { fill: style.fill } : {}), ...(style.fill && style.fillStyle ? { fillStyle: style.fillStyle } : {}) };
        return { ...rest, ...textStyle, ...measureText(shape.text, style.size) } as TextShape;
    }
    return { ...rest, ...style } as StyledShape;
}

/** How many points the freehand lines hold */
function pointsOf(shapes: readonly DrawingShape[]) {
    return shapes.reduce((sum, shape) => sum + ('points' in shape ? shape.points.length / 2 : 0), 0);
}

/**
 * Canvas mode: drawing over the page (docs/canvas-mode.md). A surface over the window takes the
 * pointer (a finger draws; two fingers, the wheel and the keyboard scroll), the shapes stay on the
 * content they were drawn over, and Comment makes them one comment's drawing.
 */
export function CanvasMode({ initialShapes, onDiscard, onComment }: CanvasModeProps) {
    const t = useMessages();
    const announce = useAnnounce();
    const shortcuts = useShortcutsEnabled();
    const helpId = useId();
    const [tool, setTool] = useState<CanvasTool>('pen');
    const [style, setStyle] = useState<DrawingStyle>({ color: 'red', size: 'm' });
    const [shapes, setShapes] = useState<DrawingShape[]>(() => initialShapes ?? []);
    const shapesRef = useRef(shapes);
    shapesRef.current = shapes;
    const [past, setPast] = useState<DrawingShape[][]>([]);
    const [future, setFuture] = useState<DrawingShape[][]>([]);
    const [selectedId, setSelectedId] = useState<string>();
    // The shape being drawn, moved or resized, shown in place of the saved one
    const [live, setLive] = useState<DrawingShape>();
    const liveRef = useRef<DrawingShape>(undefined);
    const [erasing, setErasing] = useState<ReadonlySet<string>>(() => new Set());
    const [editing, setEditing] = useState<TextEditing>();
    const finishedEditsRef = useRef(new WeakSet<TextEditing>());
    const [error, setError] = useState<string>();
    // Shapes from Edit drawing are on the page; a new drawing's frame is chosen by its first shape
    const frameRef = useRef<CanvasFrame>(null);
    const [offset, setOffset] = useState<Point>(() => frameOffset(null));
    const gestureRef = useRef<Gesture>(undefined);
    const pointersRef = useRef(new Map<number, Point>());
    const surfaceRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLTextAreaElement>(null);
    const [focusRequest, setFocusRequest] = useState<string>();

    const setLiveShape = (shape: DrawingShape | undefined) => {
        liveRef.current = shape;
        setLive(shape);
    };

    // The frame's content moves under the window: the shapes go with it
    useEffect(() => {
        let frame = 0;
        const update = () => {
            window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(() => setOffset(frameOffset(frameRef.current)));
        };
        window.addEventListener('scroll', update, { capture: true, passive: true });
        window.addEventListener('resize', update);
        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener('scroll', update, { capture: true });
            window.removeEventListener('resize', update);
        };
    }, []);

    useLayoutEffect(() => {
        surfaceRef.current?.focus({ preventScroll: true });
        announce(t.canvas.started);
        // Once, as canvas mode starts
    }, []);

    const toFrame = (clientX: number, clientY: number): Point => {
        const current = frameOffset(frameRef.current);
        return { x: clientX - current.x, y: clientY - current.y };
    };

    // The shapes are read before the updates: React may run an updater only in the next render,
    // when shapesRef already holds the new shapes
    const commit = (next: DrawingShape[]) => {
        const current = shapesRef.current;
        setPast(list => [...list.slice(-(historyLimit - 1)), current]);
        setFuture([]);
        shapesRef.current = next;
        setShapes(next);
        setError(undefined);
    };

    const undo = () => {
        const previous = past.at(-1);
        if (!previous) return;
        const current = shapesRef.current;
        setPast(list => list.slice(0, -1));
        setFuture(list => [current, ...list]);
        shapesRef.current = previous;
        setShapes(previous);
        if (!previous.some(shape => shape.id === selectedId)) setSelectedId(undefined);
        announce(t.canvas.undone);
    };
    const redo = () => {
        const next = future[0];
        if (!next) return;
        const current = shapesRef.current;
        setFuture(list => list.slice(1));
        setPast(list => [...list, current]);
        shapesRef.current = next;
        setShapes(next);
        if (!next.some(shape => shape.id === selectedId)) setSelectedId(undefined);
        announce(t.canvas.redone);
    };

    const shapeName = (shape: DrawingShape) => t.canvas.shape(t.canvas.shapes[shape.type], shapes.filter(other => other.type === shape.type).indexOf(shape) + 1);

    const selected = shapes.find(shape => shape.id === selectedId);
    const deleteSelected = () => {
        if (!selected) return;
        const index = shapes.indexOf(selected);
        const next = shapes.filter(shape => shape !== selected);
        announce(t.canvas.deleted(shapeName(selected)));
        commit(next);
        setSelectedId(undefined);
        // The focus goes to the next shape, else the surface
        const neighbour = next[Math.min(index, next.length - 1)];
        if (neighbour) setFocusRequest(neighbour.id);
        else surfaceRef.current?.focus({ preventScroll: true });
    };

    const replaceShape = (shape: DrawingShape) => commit(shapesRef.current.map(other => other.id === shape.id ? shape : other));

    const isFull = (extraPoints = 0) => {
        if (shapesRef.current.length >= drawingLimits.shapes || pointsOf(shapesRef.current) + extraPoints > drawingLimits.points) {
            setError(t.canvas.full);
            announce(t.canvas.full);
            return true;
        }
        return false;
    };

    const changeTool = (next: CanvasTool) => {
        setTool(next);
        setSelectedId(undefined);
    };

    // The style applies to the selected shape, and to the next ones
    const changeStyle = (patch: Partial<DrawingStyle>) => {
        const base = selected && isStyledShape(selected) ? styleOf(selected) : style;
        const next = withStyle(base, patch);
        setStyle(current => withStyle(current, patch));
        if (selected && isStyledShape(selected)) replaceShape(restyled(selected, next));
    };

    // Text notes
    const startEditing = (point: Point, shape?: TextShape) => {
        setSelectedId(undefined);
        setEditing(shape
            ? { id: shape.id, x: shape.x, y: shape.y, text: shape.text, style: styleOf(shape), isNew: false }
            : { id: newId(), x: point.x, y: point.y, text: '', style: withStyle(style, { dash: undefined, sketchy: undefined }), isNew: true });
    };
    const finishEditing = (focusSurface: boolean) => {
        const current = editing;
        // Once: focusing the surface blurs the note's field, which finishes it again in the same render
        if (!current || finishedEditsRef.current.has(current)) return;
        finishedEditsRef.current.add(current);
        setEditing(undefined);
        const text = drawingText(current.text).split('\n').slice(0, drawingLimits.textLines).join('\n').slice(0, drawingLimits.text);
        const existing = shapesRef.current.find(shape => shape.id === current.id);
        if (!/[^\s]/u.test(text)) {
            if (existing) commit(shapesRef.current.filter(shape => shape.id !== current.id));
        } else if (!existing && isFull()) {
            // Nothing added
        } else {
            const note: TextShape = {
                type: 'text', id: current.id, seed: existing?.seed ?? newSeed(), ...current.style,
                x: current.x, y: current.y, text, ...measureText(text, current.style.size)
            };
            if (existing) {
                if (JSON.stringify(note) !== JSON.stringify(existing)) replaceShape(note);
            } else {
                commit([...shapesRef.current, note]);
                announce(t.canvas.added(t.canvas.shapes.text));
            }
        }
        if (focusSurface) surfaceRef.current?.focus({ preventScroll: true });
    };
    useEffect(() => {
        if (editing) textRef.current?.focus({ preventScroll: true });
    }, [editing?.id]);

    // A shape added with the keyboard, or focused after a deletion, gets the focus once it is drawn
    useEffect(() => {
        if (!focusRequest) return;
        surfaceRef.current?.querySelector<SVGElement>(`[data-uier-canvas-shape="${focusRequest}"]`)?.focus({ preventScroll: true });
        setFocusRequest(undefined);
    }, [focusRequest]);

    /** Enter on the surface: the tool's shape in the middle of the window (the keyboard's way to draw) */
    const insertShape = () => {
        const middle = toFrame(window.innerWidth / 2, window.innerHeight / 2);
        if (tool === 'text') {
            startEditing({ x: middle.x - 40, y: middle.y - 12 });
            return;
        }
        if (tool === 'select' || tool === 'eraser' || tool === 'pen' || tool === 'marker' || tool === 'brush') {
            announce(t.canvas.pointerOnly);
            return;
        }
        if (isFull()) return;
        const base = { id: newId(), seed: newSeed() };
        const box = { x: middle.x - keyboardBox.width / 2, y: middle.y - keyboardBox.height / 2, ...keyboardBox };
        const shape: DrawingShape = tool === 'blur' ? { ...base, type: 'blur', ...box }
            : tool === 'line' || tool === 'arrow'
                ? { ...base, type: tool, ...style, x1: box.x, y1: middle.y, x2: box.x + box.width, y2: middle.y }
                : { ...base, type: tool, ...style, ...box };
        commit([...shapesRef.current, shape]);
        announce(t.canvas.added(t.canvas.shapes[shape.type]));
        setSelectedId(shape.id);
        setFocusRequest(shape.id);
    };

    // Pointer: draw, select, move, resize, erase; two fingers scroll
    const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if ((event.target as Element).closest('textarea')) return;
        if (editing) {
            finishEditing(false);
            event.preventDefault();
            return;
        }
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        // No focus change, text selection or compatibility mouse events on the page
        event.preventDefault();
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (event.pointerType === 'touch' && pointersRef.current.size >= 2) {
            // A second finger: scrolling, not drawing
            setLiveShape(undefined);
            setErasing(new Set());
            const [a, b] = [...pointersRef.current.values()];
            gestureRef.current = { kind: 'pan', middle: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 } };
            return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        if (!shapesRef.current.length && tool !== 'select' && tool !== 'eraser') {
            frameRef.current = frameAt(event.clientX, event.clientY);
            setOffset(frameOffset(frameRef.current));
        }
        const point = toFrame(event.clientX, event.clientY);
        const reach = tolerance(event.pointerType);

        if (tool === 'select') {
            const handle = selected && shapeHandles(selected).find(h => Math.hypot(h.x - point.x, h.y - point.y) <= handleRadius + reach / 2);
            if (selected && handle) {
                gestureRef.current = { kind: 'resize', pointerId: event.pointerId, handle: handle.handle, original: selected };
                return;
            }
            const hit = shapeAt(shapesRef.current, point, reach);
            setSelectedId(hit?.id);
            if (hit) gestureRef.current = { kind: 'move', pointerId: event.pointerId, start: point, original: hit };
            return;
        }
        if (tool === 'eraser') {
            gestureRef.current = { kind: 'erase', pointerId: event.pointerId };
            eraseAt(point, reach);
            return;
        }
        if (tool === 'text') {
            const hit = shapeAt(shapesRef.current.filter(shape => shape.type === 'text'), point, reach);
            startEditing(point, hit?.type === 'text' ? hit : undefined);
            return;
        }
        if (isFull(1)) return;
        setSelectedId(undefined);
        const base = { id: newId(), seed: newSeed() };
        gestureRef.current = { kind: 'draw', pointerId: event.pointerId, start: point };
        if (tool === 'pen' || tool === 'marker' || tool === 'brush') {
            const pressure = event.pointerType === 'pen' ? [Math.round(event.pressure * 100)] : undefined;
            setLiveShape({ ...base, type: tool, ...style, points: [point.x, point.y], ...(pressure ? { pressures: pressure } : {}) });
        } else if (tool === 'line' || tool === 'arrow') {
            setLiveShape({ ...base, type: tool, ...style, x1: point.x, y1: point.y, x2: point.x, y2: point.y });
        } else if (tool === 'blur') {
            setLiveShape({ ...base, type: 'blur', x: point.x, y: point.y, width: 1, height: 1 });
        } else {
            setLiveShape({ ...base, type: tool, ...style, x: point.x, y: point.y, width: 1, height: 1 });
        }
    };

    const eraseAt = (point: Point, reach: number) => {
        const hit = [...shapesRef.current].reverse().find(shape => hitsShape(shape, point, reach));
        if (hit) setErasing(current => current.has(hit.id) ? current : new Set([...current, hit.id]));
    };

    const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const gesture = gestureRef.current;
        if (!pointersRef.current.has(event.pointerId)) return;
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (gesture?.kind === 'pan') {
            const [a, b] = [...pointersRef.current.values()];
            if (!a || !b) return;
            const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const dx = gesture.middle.x - middle.x;
            const dy = gesture.middle.y - middle.y;
            scrollFrameBy(scrollTargetAt(middle.x, middle.y, dx, dy), dx, dy);
            gesture.middle = middle;
            return;
        }
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        const point = toFrame(event.clientX, event.clientY);
        const current = liveRef.current;
        if (gesture.kind === 'erase') {
            eraseAt(point, tolerance(event.pointerType));
        } else if (gesture.kind === 'move') {
            setLiveShape(moveShape(gesture.original, point.x - gesture.start.x, point.y - gesture.start.y));
        } else if (gesture.kind === 'resize') {
            setLiveShape(resizeShape(gesture.original, gesture.handle, point, event.shiftKey));
        } else if (current && 'points' in current) {
            const events = event.nativeEvent.getCoalescedEvents?.() ?? [];
            const samples = events.length ? events : [event.nativeEvent];
            const points = [...current.points];
            const pressures = current.pressures ? [...current.pressures] : undefined;
            for (const sample of samples) {
                if (points.length / 2 >= drawingLimits.shapePoints) break;
                const p = toFrame(sample.clientX, sample.clientY);
                if (Math.hypot(p.x - points[points.length - 2]!, p.y - points[points.length - 1]!) < 1) continue;
                points.push(p.x, p.y);
                pressures?.push(Math.round(sample.pressure * 100));
            }
            setLiveShape({ ...current, points, ...(pressures ? { pressures } : {}) });
        } else if (current && 'x1' in current) {
            const end = lineEnd({ x: current.x1, y: current.y1 }, point, event.shiftKey);
            setLiveShape({ ...current, x2: end.x, y2: end.y });
        } else if (current && 'width' in current) {
            setLiveShape({ ...current, ...boxBetween(gesture.start, point, event.shiftKey) });
        }
    };

    const endGesture = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
        pointersRef.current.delete(event.pointerId);
        const gesture = gestureRef.current;
        if (gesture?.kind === 'pan') {
            if (pointersRef.current.size < 2) gestureRef.current = undefined;
            return;
        }
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        gestureRef.current = undefined;
        const current = liveRef.current;
        setLiveShape(undefined);
        if (gesture.kind === 'erase') {
            const ids = erasing;
            setErasing(new Set());
            if (!cancelled && ids.size) commit(shapesRef.current.filter(shape => !ids.has(shape.id)));
            return;
        }
        if (cancelled || !current) return;
        if (gesture.kind === 'move' || gesture.kind === 'resize') {
            if (JSON.stringify(current) !== JSON.stringify(gesture.original)) replaceShape(current);
            return;
        }
        // Too small to be meant: a click with a line or shape tool draws nothing
        if (('x1' in current && Math.hypot(current.x2 - current.x1, current.y2 - current.y1) < 3)
            || ('width' in current && (current.width < 3 || current.height < 3))) return;
        commit([...shapesRef.current, 'points' in current ? finishFreehand(current) : current]);
    };

    // Wheel: the page, or the scrolled element under the pointer, scrolls as without the surface
    useEffect(() => {
        const surface = surfaceRef.current;
        if (!surface) return;
        const wheel = (event: WheelEvent) => {
            if (event.ctrlKey) return;
            event.preventDefault();
            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
            const dx = event.deltaX * unit;
            const dy = event.deltaY * unit;
            scrollFrameBy(scrollTargetAt(event.clientX, event.clientY, dx, dy), dx, dy);
        };
        surface.addEventListener('wheel', wheel, { passive: false });
        return () => surface.removeEventListener('wheel', wheel);
    }, []);

    // Keys anywhere in canvas mode: undo and redo, delete, the tools' letters, Esc
    const handleKey = useEffectEvent((event: KeyboardEvent) => {
        // The surface is an application widget of its own: its letters are the tools
        const onSurface = surfaceRef.current !== null && event.composedPath().includes(surfaceRef.current);
        if (editing || (!onSurface && isLetterKeyTarget(event))) return;
        const mod = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();
        if (mod && !event.altKey && (key === 'z' || key === 'y')) {
            event.preventDefault();
            if (key === 'y' || event.shiftKey) redo();
            else undo();
            return;
        }
        if ((event.key === 'Delete' || event.key === 'Backspace') && selected && !mod) {
            event.preventDefault();
            deleteSelected();
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (gestureRef.current) {
                gestureRef.current = undefined;
                setLiveShape(undefined);
                setErasing(new Set());
            } else if (selectedId) {
                setSelectedId(undefined);
                surfaceRef.current?.focus({ preventScroll: true });
            } else if (!shapesRef.current.length) {
                onDiscard();
            }
            return;
        }
        if (!shortcuts) return;
        const letter = shortcutLetter(event);
        const next = letter && canvasTools.find(id => toolKeys[id].toLowerCase() === letter);
        if (next) {
            event.preventDefault();
            changeTool(next);
        }
    });
    useEffect(() => listenToWindowKeydown(event => handleKey(event)), []);

    // Keys on the surface and its shapes: Enter adds, the arrows move (Alt: resize), Enter edits a note
    const handleSurfaceKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if ((event.target as Element).closest('textarea')) return;
        const shapeId = (event.target as Element).getAttribute('data-uier-canvas-shape');
        const shape = shapeId ? shapes.find(other => other.id === shapeId) : undefined;
        if (!shape) {
            if (event.key === 'Enter' && event.target === event.currentTarget) {
                event.preventDefault();
                insertShape();
            }
            return;
        }
        if (event.key === 'Enter' && shape.type === 'text') {
            event.preventDefault();
            startEditing({ x: shape.x, y: shape.y }, shape);
            return;
        }
        const step = event.shiftKey ? 10 : 1;
        const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
        if (!delta || event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        const [dx, dy] = delta as [number, number];
        if (!event.altKey) {
            replaceShape(moveShape(shape, dx, dy));
        } else if ('x1' in shape) {
            replaceShape({ ...shape, x2: shape.x2 + dx, y2: shape.y2 + dy });
        } else if ('width' in shape && shape.type !== 'text') {
            replaceShape({ ...shape, width: Math.max(4, shape.width + dx), height: Math.max(4, shape.height + dy) });
        }
    };

    const visibleShapes = useMemo(() => {
        const list = shapes.filter(shape => !erasing.has(shape.id)).map(shape => shape.id === live?.id ? live : shape);
        return live && !shapes.some(shape => shape.id === live.id) ? [...list, live] : list;
    }, [shapes, live, erasing]);
    const shownSelected = visibleShapes.find(shape => shape.id === selectedId);
    const selectionBox = shownSelected && shapeBounds(shownSelected);

    const handleComment = () => {
        if (editing) finishEditing(false);
        const result = onComment(shapesRef.current, frameRef.current);
        if (result === 'tooLarge') {
            setError(t.canvas.tooLarge);
            announce(t.canvas.tooLarge);
        }
    };

    const cursor = tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair';
    const styleTarget = selected?.type ?? tool;
    const shownStyle = selected && isStyledShape(selected) ? styleOf(selected) : style;
    const editingMetrics = editing && textMetrics({ text: editing.text || ' ', size: editing.style.size });
    const editingSize = editing && measureText(editing.text || ' ', editing.style.size);

    return (
        <>
            <DrawingLayer
                data-uier-canvas-drawing=""
                className="z-[50]"
                shapes={visibleShapes}
                left={offset.x}
                top={offset.y}
                outlineBlur
                hiddenShape={editing?.id}>
                {selectionBox && (
                    <g>
                        <rect
                            x={selectionBox.x - 4}
                            y={selectionBox.y - 4}
                            width={selectionBox.width + 8}
                            height={selectionBox.height + 8}
                            rx={4}
                            style={{ fill: 'none', stroke: 'hsl(var(--brand-accent))', strokeWidth: 1.5, strokeDasharray: '4 3' }} />
                        {shapeHandles(shownSelected).map(handle => (
                            <rect
                                key={handle.handle}
                                x={handle.x - handleRadius}
                                y={handle.y - handleRadius}
                                width={handleRadius * 2}
                                height={handleRadius * 2}
                                rx={2}
                                style={{ fill: 'hsl(var(--brand-draw-white))', stroke: 'hsl(var(--brand-accent))', strokeWidth: 1.5 }} />
                        ))}
                    </g>
                )}
            </DrawingLayer>
            <div
                ref={surfaceRef}
                role="application"
                aria-label={t.canvas.surface}
                aria-describedby={helpId}
                tabIndex={0}
                data-uier-canvas=""
                data-uier-capture-exclude=""
                className="fixed inset-0 z-[50] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                style={{ touchAction: 'none', cursor }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={event => endGesture(event, false)}
                onPointerCancel={event => endGesture(event, true)}
                onLostPointerCapture={event => { if (pointersRef.current.has(event.pointerId)) endGesture(event, false); }}
                onContextMenu={event => event.preventDefault()}
                onKeyDown={handleSurfaceKeyDown}>
                <p id={helpId} className="sr-only">{t.canvas.surfaceHelp}</p>
                {/* The shapes in the Tab order: focusing one selects it */}
                <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1" style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}>
                    {shapes.map(shape => {
                        const box = shapeBounds(shape);
                        return (
                            <rect
                                key={shape.id}
                                data-uier-canvas-shape={shape.id}
                                role="button"
                                tabIndex={0}
                                aria-label={shapeName(shape)}
                                aria-pressed={shape.id === selectedId}
                                x={box.x}
                                y={box.y}
                                width={box.width}
                                height={box.height}
                                className="outline-none"
                                style={{ fill: 'transparent' }}
                                onFocus={() => { setSelectedId(shape.id); setTool('select'); }} />
                        );
                    })}
                </svg>
                {editing && editingMetrics && editingSize && (
                    <textarea
                        ref={textRef}
                        aria-label={t.canvas.textNote}
                        data-uier-canvas-text=""
                        value={editing.text}
                        maxLength={drawingLimits.text}
                        wrap="off"
                        rows={1}
                        spellCheck
                        onChange={event => setEditing({ ...editing, text: event.target.value })}
                        onKeyDown={event => {
                            event.stopPropagation();
                            if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
                                event.preventDefault();
                                finishEditing(true);
                            }
                        }}
                        onBlur={() => finishEditing(false)}
                        className={cx('absolute m-0 resize-none overflow-hidden border-0 p-0 outline-dashed outline-1 outline-offset-4 outline-[hsl(var(--brand-accent))]')}
                        style={{
                            left: editing.x + offset.x,
                            top: editing.y + offset.y,
                            width: editingSize.width + editingMetrics.fontSize,
                            height: editingSize.height,
                            font: `${textWeight} ${editingMetrics.fontSize}px/${editingMetrics.lineHeight}px ${textFont}`,
                            color: drawColor(editing.style.color),
                            background: editing.style.fill ? drawColor(editing.style.fill, editing.style.fillStyle === 'solid' ? undefined : 0.25) : 'transparent',
                            whiteSpace: 'pre',
                            touchAction: 'auto'
                        }} />
                )}
            </div>
            <CanvasPanel
                tool={tool}
                onToolChange={changeTool}
                style={shownStyle}
                styleTarget={styleTarget}
                onStyleChange={changeStyle}
                canUndo={past.length > 0}
                canRedo={future.length > 0}
                onUndo={undo}
                onRedo={redo}
                canDelete={Boolean(selected)}
                onDelete={deleteSelected}
                canComment={shapes.length > 0 || Boolean(editing?.text.trim())}
                onComment={handleComment}
                onDiscard={() => { announce(t.canvas.discarded); onDiscard(); }}
                error={error}
                shortcuts={shortcuts} />
        </>
    );
}
