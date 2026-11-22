import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cx } from '@signalco/ui-primitives/cx';
import { Down, Up } from '@signalco/ui-icons';
import { isChangeStyleValue, type ChangeStyleProperty } from '../../changeProposal';
import { useMessages } from '../../i18n';
import { pageColors } from '../../pageColors';
import {
    colorFormatOf, colorFormats, displayColor, formatColor, hsvToRgb, parseColor, rgbToHsv, type ColorFormat, type Hsva
} from '../../styleValues';
import { inputFocusRingClassName } from '../@types/Comments';
import { IconTooltip } from '../IconTooltip';
import { RangeInput } from './RangeInput';
import { valueBoxClassName, valueInputClassName } from './NumberFields';

/** Behind a colour with alpha: the checkerboard every colour tool uses */
const checkerboard = 'repeating-conic-gradient(rgb(204 204 204) 0 25%, white 0 50%) 0 0 / 8px 8px';
const hueTrack = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map(hue => `hsl(${hue} 100% 50%)`).join(', ')})`;

/** A colour's swatch, on the checkerboard so transparency shows; a value that is no colour shows a struck-out box */
export function ColorSwatch({ color, className }: { color: string | undefined; className?: string }) {
    return <span aria-hidden="true" className={cx('relative inline-block size-4 shrink-0 overflow-hidden rounded-[4px]', className)}
        style={{ background: checkerboard }}>
        {color
            ? <span className="absolute inset-0" style={{ background: color }} />
            : <span className="absolute inset-0 bg-background bg-[linear-gradient(to_top_right,transparent_calc(50%-1px),hsl(var(--destructive))_50%,transparent_calc(50%+1px))]" />}
        {/* An edge in the theme's ink, so white shows on a light popover and black on a dark one */}
        <span className="absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_hsl(var(--foreground)/0.25)]" />
    </span>;
}

/** The browser's own computed form (`rgb(15, 118, 110)`, with commas), which nobody typed */
const isComputedRgb = (value: string) => /^\s*rgba?\(\s*\d+,/i.test(value);

/** The colour CSS can paint, when the value is one the suggestion may hold */
const paintable = (property: ChangeStyleProperty, value: string) => isChangeStyleValue(property, value.trim()) ? value.trim() : undefined;

/**
 * A colour: its swatch and value in one button that shows the picker under it, in the editor (a saturation and
 * brightness map, hue and opacity sliders, the value in hex, RGB or HSL, and the page's own colours), so it never
 * covers the editor or the element. A value typed in the picker counts once CSS reads it as a colour; picking
 * writes it in the chosen format.
 */
export function ColorField({ id, label, value, onChange, invalid, describedBy, property }: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    invalid: boolean;
    describedBy?: string;
    property: ChangeStyleProperty;
}) {
    const t = useMessages().proposal;
    const [open, setOpen] = useState(false);
    const shown = displayColor(value);
    const pickerId = `${id}-picker`;
    return <div className="grid min-w-0 gap-2">
        <button id={id} type="button" aria-label={t.chooseColor(label)} aria-describedby={describedBy} aria-invalid={invalid || undefined}
            aria-expanded={open} aria-controls={open ? pickerId : undefined} data-uier-proposal-color={property}
            className={cx(valueBoxClassName(invalid), 'w-full cursor-pointer gap-2 px-2 text-left hover:bg-muted')}
            onClick={() => setOpen(!open)}>
            <ColorSwatch color={paintable(property, value)} />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{shown === 'transparent' ? t.transparent : shown || '—'}</span>
            {open ? <Up size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" /> : <Down size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />}
        </button>
        {open && <div id={pickerId} role="group" aria-label={label} data-uier-proposal-picker={property} className="min-w-0 rounded-lg border p-2.5">
            <ColorPicker property={property} value={value} onChange={onChange} />
        </div>}
    </div>;
}

function ColorPicker({ property, value, onChange }: { property: ChangeStyleProperty; value: string; onChange: (value: string) => void }) {
    const t = useMessages().proposal;
    const parsed = parseColor(value);
    const [hsva, setHsva] = useState<Hsva>(() => rgbToHsv(parsed ?? { r: 0, g: 0, b: 0, a: 1 }));
    // Hex unless the reviewer wrote another format: the captured originals are the browser's rgb()
    const [format, setFormat] = useState<ColorFormat>(() => /^\s*(?:rgba?|hsla?)\(/i.test(value) && !isComputedRgb(value) ? colorFormatOf(value) : 'hex');
    const [typing, setTyping] = useState<string>();
    const emitted = useRef<string>(undefined);
    const swatches = useMemo(() => pageColors(), []);
    // A value from outside the map (typed, a swatch, Reset): the map follows, keeping its hue for greys
    useEffect(() => {
        if (value === emitted.current) return;
        const color = parseColor(value);
        if (!color) return;
        const next = rgbToHsv(color);
        setHsva(previous => ({ ...next, h: next.s === 0 || next.v === 0 ? previous.h : next.h }));
    }, [value]);
    const emit = (next: Hsva) => {
        setHsva(next);
        setTyping(undefined);
        const css = formatColor(hsvToRgb(next), format);
        emitted.current = css;
        onChange(css);
    };
    const rgb = hsvToRgb(hsva);
    const solid = formatColor({ ...rgb, a: 1 }, 'rgb');

    const area = useRef<HTMLDivElement>(null);
    const pick = (event: PointerEvent) => {
        const box = area.current?.getBoundingClientRect();
        if (!box?.width || !box.height) return;
        const s = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1);
        const v = 1 - Math.min(Math.max((event.clientY - box.top) / box.height, 0), 1);
        emit({ ...hsva, s, v });
    };
    const areaKeys = (event: KeyboardEvent) => {
        const step = event.shiftKey ? 0.1 : 0.01;
        const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
        const move = moves[event.key];
        if (!move) return;
        event.preventDefault();
        emit({ ...hsva, s: Math.min(Math.max(hsva.s + move[0], 0), 1), v: Math.min(Math.max(hsva.v + move[1], 0), 1) });
    };
    const typed = (text: string) => {
        setTyping(text);
        const css = paintable(property, text);
        if (!css || !CSS.supports(property, css)) return;
        emitted.current = css;
        onChange(css);
        const color = parseColor(css);
        if (color) setHsva(previous => {
            const next = rgbToHsv(color);
            return { ...next, h: next.s === 0 || next.v === 0 ? previous.h : next.h };
        });
    };
    const changeFormat = (next: ColorFormat) => {
        setFormat(next);
        setTyping(undefined);
        if (!parsed) return;
        const css = formatColor(parsed, next);
        emitted.current = css;
        onChange(css);
    };

    return <div className="grid gap-3">
        <div ref={area} role="slider" tabIndex={0} aria-label={t.colorPicker.area}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsva.s * 100)}
            aria-valuetext={t.colorPicker.areaValue(Math.round(hsva.s * 100), Math.round(hsva.v * 100))}
            className="relative h-32 w-full cursor-crosshair touch-none rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            style={{ background: `linear-gradient(to top, black, transparent), linear-gradient(to right, white, hsl(${Math.round(hsva.h)} 100% 50%))` }}
            onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); pick(event); }}
            onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event); }}
            onKeyDown={areaKeys}>
            <span aria-hidden="true" className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.45)]"
                style={{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%`, background: solid }} />
        </div>
        <RangeInput aria-label={t.colorPicker.hue} aria-valuetext={`${Math.round(hsva.h)}°`} min={0} max={360} step={1} value={hsva.h}
            track={hueTrack} onValueChange={h => emit({ ...hsva, h })} />
        <RangeInput aria-label={t.colorPicker.opacity} aria-valuetext={`${Math.round(hsva.a * 100)}%`} min={0} max={100} step={1}
            value={Math.round(hsva.a * 100)} track={`linear-gradient(to right, transparent, ${solid}), ${checkerboard}`}
            onValueChange={a => emit({ ...hsva, a: a / 100 })} />
        <div className="flex min-w-0 items-center gap-1.5">
            <select aria-label={t.colorPicker.format} value={format} onChange={event => changeFormat(event.target.value as ColorFormat)}
                className={cx('h-8 shrink-0 cursor-pointer rounded-md border border-input bg-background px-1.5 text-base text-foreground outline-none sm:text-xs pointer-coarse:h-11', inputFocusRingClassName)}>
                {colorFormats.map(option => <option key={option} value={option}>{t.colorPicker.formats[option]}</option>)}
            </select>
            <div className={cx(valueBoxClassName(false), 'flex-1')}>
                <input type="text" spellCheck={false} autoComplete="off" aria-label={t.colorPicker.value} data-uier-proposal-input={property}
                    className={cx(valueInputClassName, 'pr-2 font-mono')}
                    value={typing ?? (parsed ? formatColor(parsed, format) : value)}
                    onChange={event => typed(event.target.value)} onBlur={() => setTyping(undefined)}
                    onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} />
            </div>
        </div>
        <div className="grid gap-1.5">
            <p className="m-0 text-xs text-muted-foreground">{t.colorPicker.pageColors}</p>
            <div className="flex flex-wrap gap-1.5">
                {property === 'background-color' && <PageSwatch label={t.transparent} color="transparent" onPick={() => { setTyping(undefined); emitted.current = 'transparent'; onChange('transparent'); }} />}
                {swatches.map(color => <PageSwatch key={color} label={color} color={color} onPick={() => { typed(color); setTyping(undefined); }} />)}
            </div>
        </div>
    </div>;
}

function PageSwatch({ label, color, onPick }: { label: string; color: string; onPick: () => void }) {
    const t = useMessages().proposal;
    return <IconTooltip label={label}>
        <button type="button" aria-label={t.colorPicker.pick(label)} onClick={onPick}
            className="grid size-6 cursor-pointer place-items-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-11">
            <ColorSwatch color={color} className="size-5" />
        </button>
    </IconTooltip>;
}
