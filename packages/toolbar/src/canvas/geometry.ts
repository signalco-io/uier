/**
 * The geometry of drawn shapes (docs/canvas-mode.md), shared by the page's SVG and the screenshot's
 * canvas: both paint the same path data, so a drawing looks the same in both. Pure: no DOM.
 */
import type { BoxShape, DrawingColor, DrawingShape, DrawingSize, DrawingStyle, FreehandShape, LineShape } from '../drawing';

export const strokeWidths: Record<DrawingSize, number> = { s: 2, m: 4, l: 6, xl: 10 };
export const markerWidths: Record<DrawingSize, number> = { s: 12, m: 20, l: 28, xl: 40 };
export const brushWidths: Record<DrawingSize, number> = { s: 6, m: 10, l: 16, xl: 24 };
export const fontSizes: Record<DrawingSize, number> = { s: 14, m: 18, l: 24, xl: 32 };
export const textLineHeight = 1.3;
/** Room around a text note's lines: its background reaches this far */
export const textPadding = 6;
export const textFont = 'Geist, system-ui, -apple-system, "Segoe UI", sans-serif';
export const textWeight = 500;
export const markerOpacity = 0.4;
/** A translucent background */
export const semiFillOpacity = 0.25;
/** How strongly a blurred area is blurred, in CSS pixels */
export const blurRadius = 10;

/** A piece of a shape to paint: an outline (`stroke`) or an area (`fill`) */
export type ShapePart = {
    d: string;
    paint: 'stroke' | 'fill';
    color: DrawingColor;
    width?: number;
    opacity?: number;
    dash?: number[];
};

export type Point = { x: number; y: number };
export type Bounds = { x: number; y: number; width: number; height: number };

const n = (value: number) => Math.round(value * 10) / 10;

/** A small seeded random generator (mulberry32): a sketchy outline is the same on every page */
export function random(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function newSeed() {
    return Math.floor(Math.random() * 0x7fffffff);
}

export function shapeWidth(shape: DrawingShape) {
    if (shape.type === 'blur' || shape.type === 'text') return 0;
    if (shape.type === 'marker') return markerWidths[shape.size];
    if (shape.type === 'brush') return brushWidths[shape.size];
    return strokeWidths[shape.size];
}

export function dashArray(style: Pick<DrawingStyle, 'dash'>, width: number): number[] | undefined {
    if (style.dash === 'dashed') return [width * 2 + 6, width * 2 + 6];
    // Round caps turn the short dashes into dots
    if (style.dash === 'dotted') return [0.01, width * 2 + 4];
    return undefined;
}

function pairs(points: number[]): Point[] {
    const list: Point[] = [];
    for (let i = 0; i + 1 < points.length; i += 2) list.push({ x: points[i]!, y: points[i + 1]! });
    return list;
}

/** A line through the points, smoothed with curves through their midpoints */
export function smoothPath(points: Point[]) {
    const first = points[0];
    if (!first) return '';
    if (points.length === 1) return `M${n(first.x)} ${n(first.y)}l0.01 0`;
    let d = `M${n(first.x)} ${n(first.y)}`;
    for (let i = 1; i < points.length - 1; i++) {
        const p = points[i]!;
        const next = points[i + 1]!;
        d += `Q${n(p.x)} ${n(p.y)} ${n((p.x + next.x) / 2)} ${n((p.y + next.y) / 2)}`;
    }
    const last = points[points.length - 1]!;
    return `${d}L${n(last.x)} ${n(last.y)}`;
}

/**
 * The outline of a brush line, wider where it is pressed harder (a stylus) or drawn slower (a mouse or
 * finger), tapered at its ends
 */
export function brushOutline(points: Point[], pressures: number[] | undefined, width: number) {
    if (!points.length) return '';
    if (points.length === 1) {
        const p = points[0]!;
        const r = width / 2;
        return `M${n(p.x - r)} ${n(p.y)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
    }
    // Pressure: the stylus's, else from the speed, smoothed
    let previous = 0.6;
    const radii = points.map((p, i) => {
        const before = points[i - 1];
        let pressure = pressures?.[i] !== undefined ? pressures[i]! / 100 : undefined;
        if (pressure === undefined) {
            const distance = before ? Math.hypot(p.x - before.x, p.y - before.y) : 0;
            pressure = Math.min(1, Math.max(0.35, 1 - distance / (width * 3)));
        }
        previous = previous + (pressure - previous) * 0.35;
        const taper = Math.min(1, (i + 1) / 4, (points.length - i) / 4);
        return Math.max(0.6, (width / 2) * (0.35 + 0.65 * previous) * (0.4 + 0.6 * taper));
    });
    const left: Point[] = [];
    const right: Point[] = [];
    points.forEach((p, i) => {
        const a = points[Math.max(0, i - 1)]!;
        const b = points[Math.min(points.length - 1, i + 1)]!;
        const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = -(b.y - a.y) / length;
        const ny = (b.x - a.x) / length;
        const r = radii[i]!;
        left.push({ x: p.x + nx * r, y: p.y + ny * r });
        right.push({ x: p.x - nx * r, y: p.y - ny * r });
    });
    const end = radii[radii.length - 1]!;
    const start = radii[0]!;
    const back = right.reverse();
    const lastRight = back[0]!;
    const firstLeft = left[0]!;
    return `${smoothPath(left)}A${n(end)} ${n(end)} 0 0 1 ${n(lastRight.x)} ${n(lastRight.y)}${smoothPath(back).replace(/^M/, 'L')}A${n(start)} ${n(start)} 0 0 1 ${n(firstLeft.x)} ${n(firstLeft.y)}Z`;
}

/** A line drawn twice by hand: each pass starts and ends a little off, with a slight bow */
function roughLine(a: Point, b: Point, next: () => number, passes = 2) {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!length) return `M${n(a.x)} ${n(a.y)}l0.01 0`;
    const jitter = Math.min(length * 0.03, 2.5);
    const bow = Math.min(length * 0.025, 3);
    const nx = -(b.y - a.y) / length;
    const ny = (b.x - a.x) / length;
    const off = (amount: number) => (next() * 2 - 1) * amount;
    let d = '';
    for (let pass = 0; pass < passes; pass++) {
        const start = { x: a.x + off(jitter), y: a.y + off(jitter) };
        const end = { x: b.x + off(jitter), y: b.y + off(jitter) };
        const middle = 0.4 + next() * 0.2;
        const bend = off(bow);
        const cx = start.x + (end.x - start.x) * middle + nx * bend;
        const cy = start.y + (end.y - start.y) * middle + ny * bend;
        d += `M${n(start.x)} ${n(start.y)}Q${n(cx)} ${n(cy)} ${n(end.x)} ${n(end.y)}`;
    }
    return d;
}

/** A closed curve through the points (Catmull-Rom as cubic Béziers) */
function closedCurve(points: Point[], close: boolean) {
    let d = `M${n(points[0]!.x)} ${n(points[0]!.y)}`;
    const at = (i: number) => points[close ? (i + points.length) % points.length : Math.min(Math.max(i, 0), points.length - 1)]!;
    const count = close ? points.length : points.length - 1;
    for (let i = 0; i < count; i++) {
        const p0 = at(i - 1);
        const p1 = at(i);
        const p2 = at(i + 1);
        const p3 = at(i + 2);
        d += `C${n(p1.x + (p2.x - p0.x) / 6)} ${n(p1.y + (p2.y - p0.y) / 6)} ${n(p2.x - (p3.x - p1.x) / 6)} ${n(p2.y - (p3.y - p1.y) / 6)} ${n(p2.x)} ${n(p2.y)}`;
    }
    return close ? `${d}Z` : d;
}

/** An ellipse drawn by hand: twice, a little off and overshooting where it closes */
function roughEllipse(box: Bounds, next: () => number) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const rx = box.width / 2;
    const ry = box.height / 2;
    const count = Math.max(8, Math.min(16, Math.round((rx + ry) / 20)));
    let d = '';
    for (let pass = 0; pass < 2; pass++) {
        const start = next() * Math.PI * 2;
        const wobble = Math.min(rx, ry) * 0.05 + 1;
        const points: Point[] = [];
        // A little more than a full turn: the ends overlap like a hand-drawn ellipse
        const turn = Math.PI * 2 * (1.04 + next() * 0.06);
        for (let i = 0; i <= count; i++) {
            const angle = start + (turn * i) / count;
            const r = 1 + ((next() * 2 - 1) * wobble) / Math.max(rx, ry, 1);
            points.push({ x: cx + Math.cos(angle) * rx * r, y: cy + Math.sin(angle) * ry * r });
        }
        d += closedCurve(points, false);
    }
    return d;
}

function corners(shape: BoxShape) {
    const { x, y, width, height } = shape;
    if (shape.type === 'diamond') {
        return [{ x: x + width / 2, y }, { x: x + width, y: y + height / 2 }, { x: x + width / 2, y: y + height }, { x, y: y + height / 2 }];
    }
    return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
}

/** The clean outline of a rectangle (soft corners, BRAND.md), an ellipse or a diamond, also its background */
function boxPath(shape: BoxShape) {
    const { x, y, width, height } = shape;
    if (shape.type === 'ellipse') {
        const rx = width / 2;
        const ry = height / 2;
        return `M${n(x)} ${n(y + ry)}a${n(rx)} ${n(ry)} 0 1 0 ${n(width)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-width)} 0Z`;
    }
    if (shape.type === 'diamond') {
        const [a, b, c, d] = corners(shape);
        return `M${n(a!.x)} ${n(a!.y)}L${n(b!.x)} ${n(b!.y)}L${n(c!.x)} ${n(c!.y)}L${n(d!.x)} ${n(d!.y)}Z`;
    }
    const r = Math.min(6, width / 4, height / 4);
    return `M${n(x + r)} ${n(y)}H${n(x + width - r)}Q${n(x + width)} ${n(y)} ${n(x + width)} ${n(y + r)}V${n(y + height - r)}Q${n(x + width)} ${n(y + height)} ${n(x + width - r)} ${n(y + height)}H${n(x + r)}Q${n(x)} ${n(y + height)} ${n(x)} ${n(y + height - r)}V${n(y + r)}Q${n(x)} ${n(y)} ${n(x + r)} ${n(y)}Z`;
}

/** An arrow's head: two lines back from its tip */
export function arrowHead(shape: Pick<LineShape, 'x1' | 'y1' | 'x2' | 'y2'>, width: number) {
    const length = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1);
    const size = Math.min(length * 0.45, 10 + width * 3);
    const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
    const spread = Math.PI / 7;
    return [
        { x: shape.x2 - size * Math.cos(angle - spread), y: shape.y2 - size * Math.sin(angle - spread) },
        { x: shape.x2 - size * Math.cos(angle + spread), y: shape.y2 - size * Math.sin(angle + spread) }
    ] as const;
}

/** What to paint for a shape, bottom to top. Text and blur are painted by their renderers. */
export function shapeParts(shape: DrawingShape): ShapePart[] {
    if (shape.type === 'blur' || shape.type === 'text') return [];
    const width = shapeWidth(shape);
    const dash = dashArray(shape, width);
    const stroke = (d: string): ShapePart => ({ d, paint: 'stroke', color: shape.color, width, ...(dash ? { dash } : {}) });
    const next = random(shape.seed);
    switch (shape.type) {
        case 'pen':
            return [stroke(smoothPath(pairs(shape.points)))];
        case 'marker':
            return [{ ...stroke(smoothPath(pairs(shape.points))), opacity: markerOpacity }];
        case 'brush':
            return [{ d: brushOutline(pairs(shape.points), shape.pressures, width), paint: 'fill', color: shape.color }];
        case 'line':
        case 'arrow': {
            const a = { x: shape.x1, y: shape.y1 };
            const b = { x: shape.x2, y: shape.y2 };
            const parts = [stroke(shape.sketchy ? roughLine(a, b, next) : `M${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}`)];
            if (shape.type === 'arrow' && (a.x !== b.x || a.y !== b.y)) {
                const [left, right] = arrowHead(shape, width);
                // The head is always solid: dashes would break it up
                parts.push({ ...stroke(shape.sketchy
                    ? `${roughLine(left, b, next, 1)}${roughLine(b, right, next, 1)}`
                    : `M${n(left.x)} ${n(left.y)}L${n(b.x)} ${n(b.y)}L${n(right.x)} ${n(right.y)}`), dash: undefined });
            }
            return parts;
        }
        default: {
            const parts: ShapePart[] = [];
            const clean = boxPath(shape);
            if (shape.fill) parts.push({ d: clean, paint: 'fill', color: shape.fill, ...(shape.fillStyle === 'solid' ? {} : { opacity: semiFillOpacity }) });
            if (!shape.sketchy) parts.push(stroke(clean));
            else if (shape.type === 'ellipse') parts.push(stroke(roughEllipse(shape, next)));
            else {
                const points = corners(shape);
                parts.push(stroke(points.map((p, i) => roughLine(p, points[(i + 1) % points.length]!, next)).join('')));
            }
            return parts;
        }
    }
}

/** The text note's lines, and how far the font reaches */
export function textMetrics(shape: { text: string; size: DrawingSize }) {
    const fontSize = fontSizes[shape.size];
    return { lines: shape.text.split('\n'), fontSize, lineHeight: fontSize * textLineHeight };
}

/** The box a shape covers, its outline and arrowheads included */
export function shapeBounds(shape: DrawingShape): Bounds {
    const pad = shapeWidth(shape) / 2 + ('sketchy' in shape && shape.sketchy ? 3 : 0);
    if ('points' in shape) {
        const xs = shape.points.filter((_, i) => i % 2 === 0);
        const ys = shape.points.filter((_, i) => i % 2 === 1);
        const x = Math.min(...xs) - pad;
        const y = Math.min(...ys) - pad;
        return { x, y, width: Math.max(...xs) + pad - x, height: Math.max(...ys) + pad - y };
    }
    if ('x1' in shape) {
        const points = [{ x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }];
        if (shape.type === 'arrow') points.push(...arrowHead(shape, shapeWidth(shape)));
        const x = Math.min(...points.map(p => p.x)) - pad;
        const y = Math.min(...points.map(p => p.y)) - pad;
        return { x, y, width: Math.max(...points.map(p => p.x)) + pad - x, height: Math.max(...points.map(p => p.y)) + pad - y };
    }
    if (shape.type === 'text') {
        return { x: shape.x - textPadding, y: shape.y - textPadding, width: shape.width + textPadding * 2, height: shape.height + textPadding * 2 };
    }
    return { x: shape.x - pad, y: shape.y - pad, width: shape.width + pad * 2, height: shape.height + pad * 2 };
}

export function unionBounds(list: Bounds[]): Bounds | undefined {
    if (!list.length) return undefined;
    const x = Math.min(...list.map(b => b.x));
    const y = Math.min(...list.map(b => b.y));
    return { x, y, width: Math.max(...list.map(b => b.x + b.width)) - x, height: Math.max(...list.map(b => b.y + b.height)) - y };
}

function distanceToSegment(p: Point, a: Point, b: Point) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function nearPolyline(p: Point, points: Point[], distance: number) {
    if (points.length === 1) return Math.hypot(p.x - points[0]!.x, p.y - points[0]!.y) <= distance;
    for (let i = 1; i < points.length; i++) {
        if (distanceToSegment(p, points[i - 1]!, points[i]!) <= distance) return true;
    }
    return false;
}

/** Whether the point is on the shape: on its line, or in its box (a shape, a note or a blurred area) */
export function hitsShape(shape: DrawingShape, p: Point, tolerance: number) {
    const reach = shapeWidth(shape) / 2 + tolerance;
    if (shape.type === 'pen' || shape.type === 'marker' || shape.type === 'brush') return nearPolyline(p, pairs(shape.points), reach);
    if (shape.type === 'line' || shape.type === 'arrow') {
        const points = [{ x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }];
        return nearPolyline(p, points, reach) || (shape.type === 'arrow' && arrowHead(shape, shapeWidth(shape)).some(head => distanceToSegment(p, head, points[1]!) <= reach));
    }
    const box = shapeBounds(shape);
    return p.x >= box.x - tolerance && p.x <= box.x + box.width + tolerance && p.y >= box.y - tolerance && p.y <= box.y + box.height + tolerance;
}

/** The topmost shape at the point */
export function shapeAt(shapes: readonly DrawingShape[], p: Point, tolerance: number) {
    for (let i = shapes.length - 1; i >= 0; i--) {
        if (hitsShape(shapes[i]!, p, tolerance)) return shapes[i];
    }
    return undefined;
}

export function moveShape<T extends DrawingShape>(shape: T, dx: number, dy: number): T {
    if ('points' in shape) return { ...shape, points: shape.points.map((v, i) => v + (i % 2 ? dy : dx)) };
    if ('x1' in shape) return { ...shape, x1: shape.x1 + dx, y1: shape.y1 + dy, x2: shape.x2 + dx, y2: shape.y2 + dy };
    return { ...shape, x: shape.x + dx, y: shape.y + dy };
}

/** The handles a selected shape can be resized by: a line's ends, a box's corners. Freehand lines and notes only move. */
export type Handle = 'start' | 'end' | 'nw' | 'ne' | 'se' | 'sw';

export function shapeHandles(shape: DrawingShape): { handle: Handle; x: number; y: number }[] {
    if (shape.type === 'line' || shape.type === 'arrow') return [{ handle: 'start', x: shape.x1, y: shape.y1 }, { handle: 'end', x: shape.x2, y: shape.y2 }];
    if (shape.type === 'rectangle' || shape.type === 'ellipse' || shape.type === 'diamond' || shape.type === 'blur') {
        const { x, y, width, height } = shape;
        return [{ handle: 'nw', x, y }, { handle: 'ne', x: x + width, y }, { handle: 'se', x: x + width, y: y + height }, { handle: 'sw', x, y: y + height }];
    }
    return [];
}

/** A box between two corners, at least a pixel on a side */
export function boxBetween(a: Point, b: Point, square = false): Bounds {
    let width = Math.abs(b.x - a.x);
    let height = Math.abs(b.y - a.y);
    if (square) width = height = Math.max(width, height);
    return { x: b.x < a.x ? a.x - width : a.x, y: b.y < a.y ? a.y - height : a.y, width: Math.max(1, width), height: Math.max(1, height) };
}

/** A line's end at the point, at a multiple of 15° from its start with `snap` */
export function lineEnd(start: Point, p: Point, snap: boolean): Point {
    if (!snap) return p;
    const length = Math.hypot(p.x - start.x, p.y - start.y);
    const angle = Math.round(Math.atan2(p.y - start.y, p.x - start.x) / (Math.PI / 12)) * (Math.PI / 12);
    return { x: start.x + Math.cos(angle) * length, y: start.y + Math.sin(angle) * length };
}

/** The shape with the handle moved to the point (`square` keeps a box's sides equal) */
export function resizeShape<T extends DrawingShape>(shape: T, handle: Handle, p: Point, square = false): T {
    if (shape.type === 'line' || shape.type === 'arrow') {
        return handle === 'start'
            ? { ...shape, ...(() => { const q = lineEnd({ x: shape.x2, y: shape.y2 }, p, square); return { x1: q.x, y1: q.y }; })() }
            : { ...shape, ...(() => { const q = lineEnd({ x: shape.x1, y: shape.y1 }, p, square); return { x2: q.x, y2: q.y }; })() };
    }
    if (!('width' in shape) || shape.type === 'text') return shape;
    const opposite = {
        nw: { x: shape.x + shape.width, y: shape.y + shape.height },
        ne: { x: shape.x, y: shape.y + shape.height },
        se: { x: shape.x, y: shape.y },
        sw: { x: shape.x + shape.width, y: shape.y }
    }[handle as 'nw' | 'ne' | 'se' | 'sw'];
    return opposite ? { ...shape, ...boxBetween(opposite, p, square) } : shape;
}

/** The point indexes a line keeps when simplified to within `tolerance` pixels (Ramer–Douglas–Peucker) */
export function simplifiedIndexes(points: Point[], tolerance: number): number[] {
    if (points.length <= 2) return points.map((_, i) => i);
    const keep = new Set([0, points.length - 1]);
    const stack: [number, number][] = [[0, points.length - 1]];
    while (stack.length) {
        const [from, to] = stack.pop()!;
        let farthest = -1;
        let distance = tolerance;
        for (let i = from + 1; i < to; i++) {
            const d = distanceToSegment(points[i]!, points[from]!, points[to]!);
            if (d > distance) {
                distance = d;
                farthest = i;
            }
        }
        if (farthest >= 0) {
            keep.add(farthest);
            stack.push([from, farthest], [farthest, to]);
        }
    }
    return [...keep].sort((a, b) => a - b);
}

/** A freehand line as it is kept: simplified, in whole pixels */
export function finishFreehand(shape: FreehandShape): FreehandShape {
    const points = pairs(shape.points);
    const kept = simplifiedIndexes(points, shape.type === 'pen' ? 0.6 : 1.2);
    return {
        ...shape,
        points: kept.flatMap(i => [Math.round(points[i]!.x), Math.round(points[i]!.y)]),
        ...(shape.pressures ? { pressures: kept.map(i => shape.pressures![i] ?? 50) } : {})
    };
}

/** All of a shape's numbers in whole pixels (a drawing is kept that way, smaller) */
export function roundShape<T extends DrawingShape>(shape: T): T {
    const round = (value: number) => Math.round(value);
    if ('points' in shape) return { ...shape, points: shape.points.map(round) };
    if ('x1' in shape) return { ...shape, x1: round(shape.x1), y1: round(shape.y1), x2: round(shape.x2), y2: round(shape.y2) };
    return { ...shape, x: round(shape.x), y: round(shape.y), width: Math.max(1, round(shape.width)), height: Math.max(1, round(shape.height)) };
}
