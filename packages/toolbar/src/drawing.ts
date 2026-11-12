/**
 * Drawings on the page (canvas mode, docs/canvas-mode.md): the vector shapes a reviewer draws over the
 * page, saved with one comment. Pure (no DOM, no React): the toolbar, the API's validation and DTOs, and
 * the feedback packet share it (`@uier/toolbar/drawing`).
 *
 * Coordinates are CSS pixels from the top-left corner of the comment's area (a point anchor with a
 * width and a height, around the drawing): the drawing stays where it was drawn as the page scrolls,
 * and moves with the element that holds the area. Colours are names of the brand's drawing
 * tokens (`--brand-draw-<name>`), never raw values. Everything here comes from a reviewer's browser:
 * the parser keeps only this closed vocabulary, bounded numbers and short plain text.
 */

export const drawingVersion = 1;

export const drawingColors = ['ink', 'white', 'red', 'amber', 'green', 'blue', 'violet'] as const;
export type DrawingColor = typeof drawingColors[number];

/** Stroke width, marker and brush width, and text size, from thin to extra bold */
export const drawingSizes = ['s', 'm', 'l', 'xl'] as const;
export type DrawingSize = typeof drawingSizes[number];

export const drawingDashes = ['dashed', 'dotted'] as const;
export type DrawingDash = typeof drawingDashes[number];

export const freehandShapeTypes = ['pen', 'marker', 'brush'] as const;
export const lineShapeTypes = ['line', 'arrow'] as const;
export const boxShapeTypes = ['rectangle', 'ellipse', 'diamond'] as const;
export const drawingShapeTypes = [...freehandShapeTypes, ...lineShapeTypes, ...boxShapeTypes, 'text', 'blur'] as const;
export type DrawingShapeType = typeof drawingShapeTypes[number];

/**
 * How a shape looks. `dash` missing is a solid outline, `fill` missing is no background, `fillStyle`
 * missing is a translucent background (`solid` covers what is under it), `sketchy` draws lines,
 * arrows and shape outlines by hand.
 */
export type DrawingStyle = {
    color: DrawingColor;
    size: DrawingSize;
    dash?: DrawingDash;
    fill?: DrawingColor;
    fillStyle?: 'solid';
    sketchy?: true;
};

/** `seed` makes a sketchy outline the same wherever it is drawn */
type ShapeBase = { id: string; seed: number };
/** `points`: x, y pairs. `pressures`: a stylus's pressure at each point, 0 to 100 (a mouse or finger has none) */
export type FreehandShape = ShapeBase & DrawingStyle & { type: typeof freehandShapeTypes[number]; points: number[]; pressures?: number[] };
/** An arrow points at its end (`x2`, `y2`) */
export type LineShape = ShapeBase & DrawingStyle & { type: typeof lineShapeTypes[number]; x1: number; y1: number; x2: number; y2: number };
export type BoxShape = ShapeBase & DrawingStyle & { type: typeof boxShapeTypes[number]; x: number; y: number; width: number; height: number };
/** A text note: its lines at the top-left corner, in a box of the size it was written in (a background fills it) */
export type TextShape = ShapeBase & DrawingStyle & { type: 'text'; x: number; y: number; width: number; height: number; text: string };
/** A blurred part of the page: hides what is under it, in the screenshot too */
export type BlurShape = ShapeBase & { type: 'blur'; x: number; y: number; width: number; height: number };
export type DrawingShape = FreehandShape | LineShape | BoxShape | TextShape | BlurShape;
export type StyledShape = Exclude<DrawingShape, BlurShape>;

export type CommentDrawing = {
    version: typeof drawingVersion;
    /** The size of the drawing's box (all of its shapes, with some room), CSS pixels */
    width: number;
    height: number;
    /** Bottom to top */
    shapes: DrawingShape[];
};

export const drawingLimits = {
    shapes: 200,
    /** Points of one freehand line, and of all of them */
    shapePoints: 1000,
    points: 6000,
    /** Characters of a text note, and its lines */
    text: 500,
    textLines: 20,
    /** The longest side of the drawing's box, and how far from the area a shape can be, in CSS pixels */
    side: 20_000,
    /** Characters of the drawing as JSON: one comment's drawing, within the list and request budgets */
    length: 32_000
} as const;

export function isStyledShape(shape: DrawingShape): shape is StyledShape {
    return shape.type !== 'blur';
}

const shapeIdPattern = /^[A-Za-z0-9_-]{1,16}$/;
// Bidirectional overrides and isolates reorder how text reads; other controls and format characters are dropped
const bidiControls = /[‪-‮⁦-⁩]/g;
// eslint-disable-next-line no-control-regex
const controls = /[\u0000-\u0009\u000b-\u001f\u007f]/g;
const visibleCharacter = /[^\p{White_Space}\p{Cc}\p{Cf}]/u;

/** A text note's text as it is kept: line breaks normalized, no control or bidirectional characters, no trailing space */
export function drawingText(text: string) {
    return text.replace(/\r\n?/g, '\n').replace(bidiControls, '').replace(controls, '').replace(/\s+$/u, '');
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T => values.includes(value as T);

/**
 * The drawing, checked: a known version, a bounded box, at most {@link drawingLimits} of shapes, points
 * and text, each shape of a known type with only its own fields, near its area. Returns the drawing
 * with only those fields, or a short reason (no echo of the values).
 */
export function parseDrawing(value: unknown): CommentDrawing | string {
    if (!value || typeof value !== 'object') return 'Drawing must be an object.';
    const { version, width, height, shapes } = value as Partial<CommentDrawing>;
    if (version !== drawingVersion) return 'Drawing version is not supported.';
    if (!isNumber(width) || !isNumber(height) || width <= 0 || height <= 0 || width > drawingLimits.side || height > drawingLimits.side)
        return 'Drawing size is invalid.';
    if (!Array.isArray(shapes) || !shapes.length) return 'Drawing needs at least one shape.';
    if (shapes.length > drawingLimits.shapes) return `Drawing has too many shapes (maximum ${drawingLimits.shapes}).`;
    const inRange = (n: unknown): n is number => isNumber(n) && Math.abs(n) <= drawingLimits.side;
    const side = (n: unknown): n is number => isNumber(n) && n > 0 && n <= drawingLimits.side;
    const ids = new Set<string>();
    let points = 0;
    const parsed: DrawingShape[] = [];
    for (const raw of shapes) {
        if (!raw || typeof raw !== 'object') return 'Drawing shape is invalid.';
        const shape = raw as Record<string, unknown>;
        const { type, id, seed } = shape;
        if (!oneOf(drawingShapeTypes, type)) return 'Drawing shape type is not supported.';
        if (typeof id !== 'string' || !shapeIdPattern.test(id) || ids.has(id)) return 'Drawing shape id is invalid.';
        ids.add(id);
        if (!Number.isInteger(seed) || (seed as number) < 0 || (seed as number) > 0x7fffffff) return 'Drawing shape seed is invalid.';
        const base = { id, seed: seed as number };
        if (type === 'blur') {
            const { x, y, width: w, height: h } = shape;
            if (!inRange(x) || !inRange(y) || !side(w) || !side(h)) return 'Drawing blur is invalid.';
            parsed.push({ ...base, type, x, y, width: w, height: h });
            continue;
        }
        const { color, size, dash, fill, fillStyle, sketchy } = shape;
        if (!oneOf(drawingColors, color) || !oneOf(drawingSizes, size) || (dash !== undefined && !oneOf(drawingDashes, dash))
            || (fill !== undefined && !oneOf(drawingColors, fill)) || (fillStyle !== undefined && fillStyle !== 'solid')
            || (sketchy !== undefined && sketchy !== true))
            return 'Drawing style is invalid.';
        const style: DrawingStyle = { color, size, ...(dash ? { dash } : {}), ...(fill ? { fill } : {}),
            ...(fill && fillStyle ? { fillStyle } : {}), ...(sketchy ? { sketchy } : {}) };
        if (oneOf(freehandShapeTypes, type)) {
            const { points: list, pressures } = shape;
            if (!Array.isArray(list) || list.length < 2 || list.length % 2 || list.length / 2 > drawingLimits.shapePoints
                || !list.every(inRange))
                return 'Drawing line points are invalid.';
            points += list.length / 2;
            if (points > drawingLimits.points) return `Drawing has too many points (maximum ${drawingLimits.points}).`;
            if (pressures !== undefined && (!Array.isArray(pressures) || pressures.length !== list.length / 2
                || !pressures.every(p => typeof p === 'number' && Number.isInteger(p) && p >= 0 && p <= 100)))
                return 'Drawing pressures are invalid.';
            parsed.push({ ...base, type, ...style, points: list as number[], ...(pressures ? { pressures: pressures as number[] } : {}) });
        } else if (oneOf(lineShapeTypes, type)) {
            const { x1, y1, x2, y2 } = shape;
            if (!inRange(x1) || !inRange(y1) || !inRange(x2) || !inRange(y2)) return 'Drawing line is invalid.';
            parsed.push({ ...base, type, ...style, x1, y1, x2, y2 });
        } else {
            const { x, y, width: w, height: h } = shape;
            if (!inRange(x) || !inRange(y) || !side(w) || !side(h)) return 'Drawing shape is invalid.';
            if (type === 'text') {
                const text = typeof shape.text === 'string' ? drawingText(shape.text) : '';
                if (!visibleCharacter.test(text) || text.length > drawingLimits.text || text.split('\n').length > drawingLimits.textLines)
                    return 'Drawing text is invalid.';
                parsed.push({ ...base, type, ...style, x, y, width: w, height: h, text });
            } else {
                parsed.push({ ...base, type: type as BoxShape['type'], ...style, x, y, width: w, height: h });
            }
        }
    }
    const drawing: CommentDrawing = { version: drawingVersion, width, height, shapes: parsed };
    return JSON.stringify(drawing).length > drawingLimits.length ? `Drawing is too large (maximum ${drawingLimits.length} characters).` : drawing;
}

/** A stored or received drawing with only its known fields, or nothing when it is not a valid one */
export function commentDrawing(value: unknown): CommentDrawing | undefined {
    if (value === undefined || value === null) return undefined;
    const parsed = parseDrawing(value);
    return typeof parsed === 'string' ? undefined : parsed;
}

/** A short fingerprint of a drawing (FNV-1a of its JSON): the same drawing, the same text */
export function drawingFingerprint(drawing: CommentDrawing) {
    let hash = 0x811c9dc5;
    const json = JSON.stringify(drawing);
    for (let i = 0; i < json.length; i++) {
        hash ^= json.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `${json.length.toString(36)}-${hash.toString(36)}`;
}

const shapeNames: Record<DrawingShapeType, [string, string]> = {
    pen: ['pen line', 'pen lines'],
    marker: ['marker line', 'marker lines'],
    brush: ['brush line', 'brush lines'],
    line: ['line', 'lines'],
    arrow: ['arrow', 'arrows'],
    rectangle: ['rectangle', 'rectangles'],
    ellipse: ['ellipse', 'ellipses'],
    diamond: ['diamond', 'diamonds'],
    text: ['text note', 'text notes'],
    blur: ['blurred area', 'blurred areas']
};

/**
 * What a drawing holds, in English for the feedback packet ("2 arrows, 1 rectangle, 1 text note"), in
 * the order the shape types are listed, and its text notes bottom to top.
 */
export function drawingSummary(drawing: CommentDrawing) {
    const counts = drawingShapeTypes.map(type => [type, drawing.shapes.filter(shape => shape.type === type).length] as const)
        .filter(([, count]) => count > 0);
    return {
        shapes: drawing.shapes.length,
        text: counts.map(([type, count]) => `${count} ${shapeNames[type][count === 1 ? 0 : 1]}`).join(', '),
        notes: drawing.shapes.flatMap(shape => shape.type === 'text' ? [shape.text] : [])
    };
}
