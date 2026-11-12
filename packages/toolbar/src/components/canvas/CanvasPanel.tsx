'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Divider } from '@signalco/ui-primitives/Divider';
import { Popper } from '@signalco/ui-primitives/Popper';
import { cx } from '@signalco/ui-primitives/cx';
import { Delete, Redo, Undo } from '@signalco/ui-icons';
import { drawingColors, drawingSizes, type DrawingColor, type DrawingShapeType, type DrawingSize, type DrawingStyle } from '../../drawing';
import { strokeWidths } from '../../canvas/geometry';
import { rovingIndex } from '../../keyboard';
import { useRovingFocus } from '../../focusKeys';
import { useMessages } from '../../i18n';
import { InkScope, useInkContainer } from '../InkScope';
import { IconTooltip, useIconTooltip } from '../IconTooltip';
import { floatingShadowClassName } from '../@types/Comments';
import { drawColor } from './DrawingLayer';
import { ArrowIcon, BlurIcon, BrushIcon, DiamondIcon, EllipseIcon, EraserIcon, LineIcon, MarkerIcon, PenIcon, RectangleIcon, SelectIcon, StyleIcon, TextIcon } from './CanvasIcons';

export const canvasTools = ['select', 'pen', 'marker', 'brush', 'line', 'arrow', 'rectangle', 'ellipse', 'diamond', 'text', 'blur', 'eraser'] as const;
export type CanvasTool = typeof canvasTools[number];

/** Each tool's key (with the single-key shortcuts on), like the canvas tools people know */
export const toolKeys: Record<CanvasTool, string> = {
    select: 'V', pen: 'P', marker: 'M', brush: 'B', line: 'L', arrow: 'A',
    rectangle: 'R', ellipse: 'O', diamond: 'D', text: 'T', blur: 'X', eraser: 'E'
};

const toolIcons: Record<CanvasTool, (props: { size?: number }) => ReactNode> = {
    select: SelectIcon, pen: PenIcon, marker: MarkerIcon, brush: BrushIcon, line: LineIcon, arrow: ArrowIcon,
    rectangle: RectangleIcon, ellipse: EllipseIcon, diamond: DiamondIcon, text: TextIcon, blur: BlurIcon, eraser: EraserIcon
};

/** Tools in groups: choosing, freehand, lines and shapes, notes and blur, erasing */
const toolGroups: CanvasTool[][] = [['select'], ['pen', 'marker', 'brush'], ['line', 'arrow', 'rectangle', 'ellipse', 'diamond'], ['text', 'blur', 'eraser']];

/** Which of the style's settings a shape type (or a tool, for its next shape) uses */
export function styleSettings(type: DrawingShapeType | 'select' | 'eraser') {
    const any = type === 'select' || type === 'eraser';
    const outlined = any || ['rectangle', 'ellipse', 'diamond'].includes(type);
    return {
        color: type !== 'blur',
        size: type !== 'blur',
        background: outlined || type === 'text',
        dash: outlined || ['pen', 'line', 'arrow'].includes(type),
        edges: outlined || ['line', 'arrow'].includes(type)
    };
}

type Option<T extends string> = { value: T; label: string; content: ReactNode };

/**
 * One choice of several (a radio group): ← → or ↑ ↓ move to the next one and choose it, Home and End to
 * the ends; one tab stop, on the chosen one
 */
function Choice<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: Option<T>[]; onChange: (value: T) => void; disabled?: boolean }) {
    const groupRef = useRef<HTMLDivElement>(null);
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const index = options.findIndex(option => option.value === value);
        const next = rovingIndex(event.key, index, options.length, { loop: true });
        if (next === undefined || event.altKey || event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        onChange(options[next]!.value);
        groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
    };
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">{label}</span>
            <div ref={groupRef} role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} className="flex flex-wrap gap-1" onKeyDown={handleKeyDown}>
                {options.map(option => {
                    const checked = option.value === value;
                    return (
                        <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={checked}
                            aria-label={option.label}
                            disabled={disabled}
                            tabIndex={checked ? 0 : -1}
                            onClick={() => onChange(option.value)}
                            className={cx(
                                'flex min-h-8 min-w-8 items-center justify-center rounded-md border px-1.5 text-xs text-foreground transition-colors duration-100 pointer-coarse:min-h-11 pointer-coarse:min-w-11',
                                checked ? 'border-foreground bg-accent' : 'border-transparent hover:bg-accent',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                                'disabled:opacity-40'
                            )}>
                            {option.content}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function Swatch({ color }: { color: DrawingColor | 'none' }) {
    return color === 'none'
        ? <span aria-hidden="true" className="block size-4 rounded-full border border-muted-foreground bg-[linear-gradient(135deg,transparent_45%,currentColor_45%,currentColor_55%,transparent_55%)]" />
        : <span aria-hidden="true" className="block size-4 rounded-full border border-border" style={{ background: drawColor(color) }} />;
}

function StylePopover({ style, settings, onChange }: { style: DrawingStyle; settings: ReturnType<typeof styleSettings>; onChange: (patch: Partial<DrawingStyle> & { fill?: DrawingColor | undefined }) => void }) {
    const t = useMessages();
    const container = useInkContainer();
    const [open, setOpen] = useState(false);
    // Blur has no colour, width or outline: the button stays focusable and says why instead of opening empty
    const disabled = !Object.values(settings).some(Boolean);
    const tip = useIconTooltip(disabled ? t.canvas.noStyle : t.canvas.style);
    const reasonId = useId();
    const colorOptions = drawingColors.map(color => ({ value: color, label: t.canvas.colors[color], content: <Swatch color={color} /> }));
    return (
        <Popper
            container={container ?? undefined}
            open={open && !disabled}
            onOpenChange={next => setOpen(next && !disabled)}
            side="bottom"
            sideOffset={8}
            aria-label={t.canvas.style}
            className={cx('z-[53] flex w-64 flex-col gap-3 rounded-xl p-3', floatingShadowClassName)}
            trigger={(
                <IconButton variant={open && !disabled ? 'soft' : 'plain'} className={cx('rounded-full', disabled && 'cursor-default opacity-40')} {...tip.triggerProps}
                    aria-label={t.canvas.style} aria-expanded={open && !disabled} aria-disabled={disabled || undefined}
                    aria-describedby={disabled ? reasonId : undefined} data-uier-canvas-style="">
                    {tip.tooltip}
                    {disabled && <span id={reasonId} hidden>{t.canvas.noStyle}</span>}
                    <span className="relative">
                        <StyleIcon />
                        <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border border-background" style={{ background: drawColor(style.color) }} />
                    </span>
                </IconButton>
            )}>
            {settings.color && <Choice label={t.canvas.color} value={style.color} options={colorOptions} onChange={color => onChange({ color })} />}
            {settings.background && <>
                <Choice
                    label={t.canvas.background}
                    value={style.fill ?? 'none'}
                    options={[{ value: 'none' as const, label: t.canvas.none, content: <Swatch color="none" /> }, ...colorOptions]}
                    onChange={fill => onChange({ fill: fill === 'none' ? undefined : fill })} />
                <Choice
                    label={t.canvas.fill}
                    value={style.fillStyle ?? 'semi'}
                    disabled={!style.fill}
                    options={(['semi', 'solid'] as const).map(fill => ({ value: fill, label: t.canvas.fills[fill], content: t.canvas.fills[fill] }))}
                    onChange={fill => onChange({ fillStyle: fill === 'solid' ? 'solid' : undefined })} />
            </>}
            {settings.dash && (
                <Choice
                    label={t.canvas.outline}
                    value={style.dash ?? 'solid'}
                    options={(['solid', 'dashed', 'dotted'] as const).map(dash => ({
                        value: dash,
                        label: t.canvas.outlines[dash],
                        content: (
                            <svg aria-hidden="true" width="24" height="8" viewBox="0 0 24 8">
                                <path d="M2 4h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray={dash === 'dashed' ? '5 4' : dash === 'dotted' ? '0.1 4' : undefined} />
                            </svg>
                        )
                    }))}
                    onChange={dash => onChange({ dash: dash === 'solid' ? undefined : dash })} />
            )}
            {settings.size && (
                <Choice<DrawingSize>
                    label={t.canvas.width}
                    value={style.size}
                    options={drawingSizes.map(size => ({
                        value: size,
                        label: t.canvas.widths[size],
                        content: <span aria-hidden="true" className="block w-5 rounded-full bg-current" style={{ height: Math.min(8, strokeWidths[size]) }} />
                    }))}
                    onChange={size => onChange({ size })} />
            )}
            {settings.edges && (
                <Choice
                    label={t.canvas.edges}
                    value={style.sketchy ? 'sketchy' : 'clean'}
                    options={(['clean', 'sketchy'] as const).map(edge => ({ value: edge, label: t.canvas.edgeStyles[edge], content: t.canvas.edgeStyles[edge] }))}
                    onChange={edge => onChange({ sketchy: edge === 'sketchy' ? true : undefined })} />
            )}
        </Popper>
    );
}

type CanvasPanelProps = {
    tool: CanvasTool;
    onToolChange: (tool: CanvasTool) => void;
    /** The selected shape's style, else the next shape's */
    style: DrawingStyle;
    /** What the style applies to: the selected shape's type, else the tool */
    styleTarget: DrawingShapeType | 'select' | 'eraser';
    onStyleChange: (patch: Partial<DrawingStyle>) => void;
    canUndo: boolean;
    canRedo: boolean;
    onUndo: () => void;
    onRedo: () => void;
    canDelete: boolean;
    onDelete: () => void;
    canComment: boolean;
    onComment: () => void;
    onDiscard: () => void;
    error?: string;
    shortcuts: boolean;
};

/** The drawing tools, above the page: one tab stop (← → between them), like the pill */
export function CanvasPanel({
    tool, onToolChange, style, styleTarget, onStyleChange, canUndo, canRedo, onUndo, onRedo, canDelete, onDelete,
    canComment, onComment, onDiscard, error, shortcuts
}: CanvasPanelProps) {
    const t = useMessages();
    const toolsRef = useRef<HTMLDivElement>(null);
    const roving = useRovingFocus(toolsRef, { orientation: 'horizontal', preferred: () => toolsRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]') });
    const modifier = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
    const settings = styleSettings(styleTarget);
    return (
        <InkScope>
            <div
                data-uier-canvas-panel=""
                data-uier-capture-exclude=""
                className="fixed left-1/2 top-3 z-[52] flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center gap-2">
                <div
                    ref={toolsRef}
                    role="toolbar"
                    aria-label={t.canvas.panel}
                    onFocus={roving.onFocus}
                    onKeyDown={roving.onKeyDown}
                    className={cx('flex max-w-full flex-wrap items-center justify-center gap-0.5 rounded-2xl border bg-background p-1 text-foreground', floatingShadowClassName)}>
                    {toolGroups.map((group, index) => (
                        <div key={index} className="flex items-center gap-0.5">
                            {index > 0 && <Divider orientation="vertical" className="mx-0.5 h-6" />}
                            {group.map(id => {
                                const Icon = toolIcons[id];
                                const key = shortcuts ? toolKeys[id] : undefined;
                                return (
                                    <IconTooltip key={id} label={t.canvas.tools[id]} shortcut={key}>
                                        <IconButton
                                            data-uier-canvas-tool={id}
                                            aria-label={t.canvas.tools[id]}
                                            aria-pressed={tool === id}
                                            aria-keyshortcuts={key}
                                            variant={tool === id ? 'solid' : 'plain'}
                                            className="rounded-full"
                                            onClick={() => onToolChange(id)}>
                                            <Icon />
                                        </IconButton>
                                    </IconTooltip>
                                );
                            })}
                        </div>
                    ))}
                    <div className="flex items-center gap-0.5">
                        <Divider orientation="vertical" className="mx-0.5 h-6" />
                        <StylePopover style={style} settings={settings} onChange={onStyleChange} />
                        <IconTooltip label={t.canvas.undo} shortcut={`${modifier}+Z`}>
                            <IconButton variant="plain" className="rounded-full" aria-label={t.canvas.undo} aria-keyshortcuts="Control+Z Meta+Z" disabled={!canUndo} onClick={onUndo}><Undo /></IconButton>
                        </IconTooltip>
                        <IconTooltip label={t.canvas.redo} shortcut={`${modifier}+Shift+Z`}>
                            <IconButton variant="plain" className="rounded-full" aria-label={t.canvas.redo} aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z" disabled={!canRedo} onClick={onRedo}><Redo /></IconButton>
                        </IconTooltip>
                        <IconTooltip label={t.canvas.deleteShape} shortcut="Delete">
                            <IconButton variant="plain" className="rounded-full" aria-label={t.canvas.deleteShape} aria-keyshortcuts="Delete Backspace" disabled={!canDelete} onClick={onDelete}><Delete /></IconButton>
                        </IconTooltip>
                    </div>
                    <div className="flex items-center gap-1 pl-1">
                        <Divider orientation="vertical" className="mr-0.5 h-6" />
                        <Button size="sm" variant="plain" className="rounded-full" data-uier-canvas-discard="" onClick={onDiscard}>{t.canvas.discard}</Button>
                        <Button size="sm" variant="solid" className="rounded-full" data-uier-canvas-comment="" disabled={!canComment} onClick={onComment}>{t.canvas.comment}</Button>
                    </div>
                </div>
                {error && <p role="alert" className="m-0 rounded-xl border bg-background px-3 py-2 text-sm text-foreground">{error}</p>}
            </div>
        </InkScope>
    );
}
