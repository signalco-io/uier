/**
 * Paints a drawing into a screenshot (docs/canvas-mode.md): the same path data as the page's SVG
 * (`geometry.ts`), on a 2D canvas. Blurred areas are blurred from the screenshot's own pixels, so what
 * they cover is not readable in the saved image either.
 */
import { drawingColors, type CommentDrawing, type DrawingColor, type TextShape } from '../drawing';
import { fontSizes, shapeParts, textFont, textMetrics, textPadding, textWeight, semiFillOpacity } from './geometry';
import { getToolbarHost } from '../mount';

export type DrawingPalette = Record<DrawingColor, string>;

/** The drawing colours (the brand's `--brand-draw-*` tokens) as the toolbar's styles resolve them */
export function drawingPalette(): DrawingPalette {
    const root = getToolbarHost()?.shadowRoot?.querySelector('[data-uier-root]') ?? null;
    const style = root ? getComputedStyle(root) : undefined;
    return Object.fromEntries(drawingColors.map(color => {
        const value = style?.getPropertyValue(`--brand-draw-${color}`).trim();
        // Without the toolbar's styles (never expected): ink, so the drawing still shows
        return [color, value ? `hsl(${value})` : 'black'];
    })) as DrawingPalette;
}

/** Blurs a box of the canvas (canvas pixels) by drawing it much smaller and back */
function blurBox(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, scale: number) {
    const left = Math.max(0, Math.floor(x));
    const top = Math.max(0, Math.floor(y));
    const right = Math.min(ctx.canvas.width, Math.ceil(x + width));
    const bottom = Math.min(ctx.canvas.height, Math.ceil(y + height));
    if (right <= left || bottom <= top) return;
    const factor = Math.max(6, 8 * scale);
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round((right - left) / factor));
    small.height = Math.max(1, Math.round((bottom - top) / factor));
    const smallContext = small.getContext('2d');
    if (!smallContext) return;
    smallContext.imageSmoothingQuality = 'high';
    smallContext.drawImage(ctx.canvas, left, top, right - left, bottom - top, 0, 0, small.width, small.height);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, small.width, small.height, left, top, right - left, bottom - top);
    ctx.restore();
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, width, height, radius);
    else ctx.rect(x, y, width, height);
}

function paintText(ctx: CanvasRenderingContext2D, shape: TextShape, palette: DrawingPalette) {
    const { lines, fontSize, lineHeight } = textMetrics(shape);
    if (shape.fill) {
        ctx.globalAlpha = shape.fillStyle === 'solid' ? 1 : semiFillOpacity;
        ctx.fillStyle = palette[shape.fill];
        roundedRect(ctx, shape.x - textPadding, shape.y - textPadding, shape.width + textPadding * 2, shape.height + textPadding * 2, 6);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette[shape.color];
    ctx.font = `${textWeight} ${fontSize}px ${textFont}`;
    ctx.textBaseline = 'middle';
    lines.forEach((line, i) => ctx.fillText(line, shape.x, shape.y + lineHeight * i + lineHeight / 2));
}

/**
 * Paints the drawing on the canvas with its box's top-left corner at (`x`, `y`) canvas pixels, `scale`
 * canvas pixels to a CSS pixel: blurred areas first, then the shapes, then the text notes (as on the page).
 */
export function paintDrawing(ctx: CanvasRenderingContext2D, drawing: CommentDrawing, x: number, y: number, scale: number, palette = drawingPalette()) {
    for (const shape of drawing.shapes) {
        if (shape.type === 'blur') blurBox(ctx, x + shape.x * scale, y + shape.y * scale, shape.width * scale, shape.height * scale, scale);
    }
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, x, y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const shape of drawing.shapes) {
        for (const part of shapeParts(shape)) {
            ctx.globalAlpha = part.opacity ?? 1;
            const path = new Path2D(part.d);
            if (part.paint === 'fill') {
                ctx.fillStyle = palette[part.color];
                ctx.fill(path);
            } else {
                ctx.strokeStyle = palette[part.color];
                ctx.lineWidth = part.width ?? 2;
                ctx.setLineDash(part.dash ?? []);
                ctx.stroke(path);
            }
        }
    }
    ctx.setLineDash([]);
    for (const shape of drawing.shapes) {
        if (shape.type === 'text') paintText(ctx, shape, palette);
    }
    ctx.restore();
}

/** The width of a text note's longest line and the height of its lines, in CSS pixels */
export function measureText(text: string, size: keyof typeof fontSizes) {
    const { lines, fontSize, lineHeight } = textMetrics({ text, size });
    const context = document.createElement('canvas').getContext('2d');
    if (context) context.font = `${textWeight} ${fontSize}px ${textFont}`;
    const width = Math.max(1, ...lines.map(line => context ? context.measureText(line).width : line.length * fontSize * 0.6));
    return { width: Math.ceil(width), height: Math.ceil(lineHeight * lines.length) };
}

