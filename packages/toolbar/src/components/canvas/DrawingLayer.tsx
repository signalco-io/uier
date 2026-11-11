'use client';

import { memo, type CSSProperties, type ReactNode } from 'react';
import { cx } from '@signalco/ui-primitives/cx';
import type { DrawingColor, DrawingShape, TextShape } from '../../drawing';
import { blurRadius, semiFillOpacity, shapeParts, textFont, textMetrics, textPadding, textWeight } from '../../canvas/geometry';

/** A drawing colour: the brand's `--brand-draw-<name>` token, the same in light and dark (it is on the page) */
export function drawColor(color: DrawingColor, opacity?: number) {
    return opacity === undefined ? `hsl(var(--brand-draw-${color}))` : `hsl(var(--brand-draw-${color}) / ${opacity})`;
}

/** A shape's outlines and areas, as SVG */
export const ShapePaths = memo(function ShapePaths({ shape }: { shape: DrawingShape }) {
    return shapeParts(shape).map((part, i) => (
        <path
            key={i}
            d={part.d}
            style={part.paint === 'fill'
                ? { fill: drawColor(part.color), fillOpacity: part.opacity }
                : {
                    fill: 'none',
                    stroke: drawColor(part.color),
                    strokeWidth: part.width,
                    strokeOpacity: part.opacity,
                    strokeDasharray: part.dash?.join(' '),
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round'
                }} />
    ));
});

/** A text note: its lines in the drawing's font, on its background */
export function TextNote({ shape, hidden }: { shape: TextShape; hidden?: boolean }) {
    const { fontSize, lineHeight } = textMetrics(shape);
    return (
        <div
            style={{
                position: 'absolute',
                left: shape.x - textPadding,
                top: shape.y - textPadding,
                width: shape.width + textPadding * 2,
                height: shape.height + textPadding * 2,
                padding: textPadding,
                boxSizing: 'border-box',
                borderRadius: 6,
                background: shape.fill ? drawColor(shape.fill, shape.fillStyle === 'solid' ? undefined : semiFillOpacity) : undefined,
                color: drawColor(shape.color),
                font: `${textWeight} ${fontSize}px/${lineHeight}px ${textFont}`,
                letterSpacing: 0,
                textAlign: 'left',
                whiteSpace: 'pre',
                overflow: 'visible',
                visibility: hidden ? 'hidden' : undefined
            }}>
            {shape.text}
        </div>
    );
}

/** A blurred part of the page. Nothing above it may set opacity or a filter: that would blur nothing (a backdrop root). */
function BlurArea({ shape, outlined }: { shape: Extract<DrawingShape, { type: 'blur' }>; outlined?: boolean }) {
    return (
        <div
            data-uier-blur=""
            style={{
                ...(outlined ? { outline: '1px dashed hsl(var(--brand-draw-ink) / 0.5)' } : {}),
                position: 'absolute',
                left: shape.x,
                top: shape.y,
                width: shape.width,
                height: shape.height,
                borderRadius: 4,
                backdropFilter: `blur(${blurRadius}px)`,
                WebkitBackdropFilter: `blur(${blurRadius}px)`,
                // A light veil, so a blurred area reads as one on a plain background too
                background: 'hsl(var(--brand-draw-white) / 0.15)'
            }} />
    );
}

type DrawingLayerProps = {
    shapes: readonly DrawingShape[];
    /** Where the shapes' (0, 0) is in the window */
    left: number;
    top: number;
    className?: string;
    style?: CSSProperties;
    /** Outline blurred areas (while drawing, so an empty one can be found) */
    outlineBlur?: boolean;
    /** A text note being edited is not shown: its text box is in its place */
    hiddenShape?: string;
    /** Drawn above the shapes in the same coordinates (selection, handles) */
    children?: ReactNode;
} & Record<`data-${string}`, string | undefined>;

/**
 * A drawing on the page: blurred areas, then the shapes, then the text notes, at fixed window
 * coordinates. It never takes presses (the pin opens its thread) and is left out of screenshots,
 * which paint the comment's own drawing themselves (`canvas/paint.ts`).
 */
export function DrawingLayer({ shapes, left, top, className, style, outlineBlur, hiddenShape, children, ...rest }: DrawingLayerProps) {
    return (
        <div
            aria-hidden="true"
            data-uier-capture-exclude=""
            {...rest}
            className={cx('pointer-events-none fixed left-0 top-0 h-0 w-0 select-none', className)}
            style={{ ...style, transform: `translate(${left}px, ${top}px)` }}>
            {shapes.map(shape => shape.type === 'blur' && <BlurArea key={shape.id} shape={shape} outlined={outlineBlur} />)}
            <svg className="absolute left-0 top-0 overflow-visible" width="1" height="1">
                {shapes.map(shape => shape.type !== 'blur' && shape.type !== 'text' && (
                    <g key={shape.id}><ShapePaths shape={shape} /></g>
                ))}
                {children}
            </svg>
            {shapes.map(shape => shape.type === 'text' && <TextNote key={shape.id} shape={shape} hidden={hiddenShape === shape.id} />)}
        </div>
    );
}
