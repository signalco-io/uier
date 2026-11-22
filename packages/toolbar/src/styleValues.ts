import type { ChangeStyleProperty } from './changeProposal';

/**
 * The values the suggestion editor reads and writes (`components/proposal/`): colours in hex, RGB and HSL,
 * lengths in px, rem, em and % with conversion between them, and font weights. Pure and browser/server safe.
 */

/** Channels 0–255, alpha 0–1 */
export type Rgba = { r: number; g: number; b: number; a: number };
/** Hue 0–360, saturation and value 0–1, alpha 0–1 */
export type Hsva = { h: number; s: number; v: number; a: number };
export type ColorFormat = 'hex' | 'rgb' | 'hsl';
export const colorFormats: readonly ColorFormat[] = ['hex', 'rgb', 'hsl'];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const numberSource = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
const channelPattern = new RegExp(`^(${numberSource})(%?)$`);
const huePattern = new RegExp(`^(${numberSource})(deg|grad|rad|turn)?$`);

function channel(token: string, scale: number): number | undefined {
    const match = channelPattern.exec(token);
    if (!match) return undefined;
    const value = Number(match[1]);
    return match[2] ? clamp(value, 0, 100) / 100 * scale : clamp(value, 0, scale);
}

function alphaChannel(token: string | undefined): number | undefined {
    if (token === undefined) return 1;
    const match = channelPattern.exec(token);
    if (!match) return undefined;
    return clamp(match[2] ? Number(match[1]) / 100 : Number(match[1]), 0, 1);
}

function hue(token: string): number | undefined {
    const match = huePattern.exec(token);
    if (!match) return undefined;
    const value = Number(match[1]);
    const degrees = match[2] === 'turn' ? value * 360 : match[2] === 'rad' ? value * 180 / Math.PI : match[2] === 'grad' ? value * 0.9 : value;
    return ((degrees % 360) + 360) % 360;
}

/** The channels of an rgb()/hsl() body in the comma or the space syntax, with its alpha */
function functionChannels(body: string): { channels: string[]; alpha?: string } | undefined {
    if (body.includes(',')) {
        const tokens = body.split(',').map(token => token.trim());
        if (tokens.length < 3 || tokens.length > 4) return undefined;
        return { channels: tokens.slice(0, 3), alpha: tokens[3] };
    }
    const [channels, alpha, ...rest] = body.split('/').map(part => part.trim());
    if (rest.length || !channels) return undefined;
    const tokens = channels.split(/\s+/);
    return tokens.length === 3 ? { channels: tokens, alpha } : undefined;
}

export function hslToRgb(h: number, s: number, l: number): Omit<Rgba, 'a'> {
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 };
}

/** Hex, rgb()/rgba(), hsl()/hsla() and `transparent`; other colour spaces are not parsed (`undefined`) */
export function parseColor(value: string): Rgba | undefined {
    const text = value.trim().toLowerCase();
    if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.exec(text)?.[1];
    if (hex) {
        const digits = hex.length < 5 ? [...hex].map(digit => digit + digit).join('') : hex;
        const pairs = digits.match(/../g)!.map(pair => Number.parseInt(pair, 16));
        return { r: pairs[0]!, g: pairs[1]!, b: pairs[2]!, a: pairs[3] === undefined ? 1 : pairs[3] / 255 };
    }
    const fn = /^(rgba?|hsla?)\((.*)\)$/.exec(text);
    if (!fn) return undefined;
    const parts = functionChannels(fn[2]!.trim());
    if (!parts) return undefined;
    const a = alphaChannel(parts.alpha);
    if (a === undefined) return undefined;
    const [first, second, third] = parts.channels as [string, string, string];
    if (fn[1]!.startsWith('rgb')) {
        const [r, g, b] = [channel(first, 255), channel(second, 255), channel(third, 255)];
        return r === undefined || g === undefined || b === undefined ? undefined : { r, g, b, a };
    }
    const h = hue(first);
    const s = channel(second.endsWith('%') ? second : `${second}%`, 1);
    const l = channel(third.endsWith('%') ? third : `${third}%`, 1);
    return h === undefined || s === undefined || l === undefined ? undefined : { ...hslToRgb(h, s, l), a };
}

export function rgbToHsl({ r, g, b }: Omit<Rgba, 'a'>): { h: number; s: number; l: number } {
    const [rn, gn, bn] = [r / 255, g / 255, b / 255];
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    const d = max - min;
    if (!d) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
    return { h: (h * 60 + 360) % 360, s, l };
}

export function rgbToHsv({ r, g, b, a }: Rgba): Hsva {
    const [rn, gn, bn] = [r / 255, g / 255, b / 255];
    const max = Math.max(rn, gn, bn);
    const d = max - Math.min(rn, gn, bn);
    const h = !d ? 0 : max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
    return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max, a };
}

export function hsvToRgb({ h, s, v, a }: Hsva): Rgba {
    const f = (n: number) => {
        const k = (n + h / 60) % 6;
        return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
    };
    return { r: f(5), g: f(3), b: f(1), a };
}

const round = (value: number, decimals = 0) => {
    const scale = 10 ** decimals;
    return Math.round(value * scale) / scale;
};

/** Written as CSS in the format: `#0f766e` (`#0f766e80` with alpha), `rgb(15 118 110 / 0.5)`, `hsl(175 77% 26%)` */
export function formatColor(color: Rgba, format: ColorFormat): string {
    const r = round(clamp(color.r, 0, 255));
    const g = round(clamp(color.g, 0, 255));
    const b = round(clamp(color.b, 0, 255));
    const a = round(clamp(color.a, 0, 1), 2);
    if (format === 'hex') {
        const hex = (value: number) => value.toString(16).padStart(2, '0');
        return `#${hex(r)}${hex(g)}${hex(b)}${a < 1 ? hex(round(a * 255)) : ''}`;
    }
    const alpha = a < 1 ? ` / ${a}` : '';
    if (format === 'rgb') return `rgb(${r} ${g} ${b}${alpha})`;
    const { h, s, l } = rgbToHsl({ r, g, b });
    return `hsl(${round(h)} ${round(s * 100)}% ${round(l * 100)}%${alpha})`;
}

/** The format a written colour is in, for the picker's format menu */
export function colorFormatOf(value: string): ColorFormat {
    const text = value.trim().toLowerCase();
    return text.startsWith('hsl') ? 'hsl' : text.startsWith('rgb') ? 'rgb' : 'hex';
}

/** How the editor shows a colour: hex when it can be read, `transparent` for none, else as written */
export function displayColor(value: string): string {
    const color = parseColor(value);
    if (!color) return value.trim();
    return color.a < 0.005 ? 'transparent' : formatColor(color, 'hex');
}

export function sameColor(a: string, b: string): boolean {
    const first = parseColor(a);
    const second = parseColor(b);
    if (!first || !second) return a.trim().toLowerCase() === b.trim().toLowerCase();
    // Fully transparent colours look the same whatever their channels
    if (first.a < 0.005 && second.a < 0.005) return true;
    return Math.abs(first.r - second.r) < 0.5 && Math.abs(first.g - second.g) < 0.5
        && Math.abs(first.b - second.b) < 0.5 && Math.abs(first.a - second.a) < 0.005;
}

export type LengthUnit = 'px' | 'rem' | 'em' | '%';
export type Length = { value: number; unit: string };
/** Font sizes in px: the root's (rem), the element's and its parent's (em and % of a font size) */
export type LengthContext = { rootFontSize: number; fontSize: number; parentFontSize: number };

export const defaultLengthContext: LengthContext = { rootFontSize: 16, fontSize: 16, parentFontSize: 16 };

const lengthPattern = new RegExp(`^(${numberSource})\\s*([a-z%]*)$`, 'i');

/** One number with its unit (`16px`, `1.5rem`, `0`); a bare number has no unit (`''`) */
export function parseLength(value: string): Length | undefined {
    const match = lengthPattern.exec(value.trim());
    if (!match) return undefined;
    return { value: Number(match[1]), unit: match[2]!.toLowerCase() };
}

/** The units offered for a property; % only where its base is known (a font size's parent) */
export function lengthUnits(property: ChangeStyleProperty): LengthUnit[] {
    return property === 'font-size' ? ['px', 'rem', 'em', '%'] : ['px', 'rem', 'em'];
}

/** How many px one of the unit is for the property, when it can be known */
export function unitSize(property: ChangeStyleProperty, unit: string, context: LengthContext): number | undefined {
    switch (unit) {
        case 'px': return 1;
        case 'rem': return context.rootFontSize;
        // A font size in em or % is of the parent's font size, any other length of the element's own
        case 'em': return property === 'font-size' ? context.parentFontSize : context.fontSize;
        case '%': return property === 'font-size' ? context.parentFontSize / 100 : undefined;
        default: return undefined;
    }
}

export function lengthToPx(length: Length, property: ChangeStyleProperty, context: LengthContext): number | undefined {
    if (length.value === 0) return 0;
    const size = unitSize(property, length.unit, context);
    return size === undefined ? undefined : length.value * size;
}

/** The same length in another unit, rounded to what a person would write; `undefined` when it can't be known */
export function convertLength(length: Length, unit: LengthUnit, property: ChangeStyleProperty, context: LengthContext): Length | undefined {
    const px = lengthToPx(length, property, context);
    const size = unitSize(property, unit, context);
    if (px === undefined || !size) return undefined;
    return { value: round(px / size, unit === 'px' || unit === '%' ? 2 : 4), unit };
}

/** A number as CSS writes it: no trailing zeros, at most four decimals */
export function formatNumber(value: number): string {
    return String(round(value, 4));
}

export function formatLength(length: Length): string {
    return `${formatNumber(length.value)}${length.unit}`;
}

/** A value as the editor and its rows show it: one length to two decimals (`13.33px`), anything else as written */
export function displayStyleValue(property: ChangeStyleProperty, value: string): string {
    const length = isLengthProperty(property) ? parseLength(value) : undefined;
    return length ? `${round(length.value, 2)}${length.unit}` : value.trim();
}

/** The slider's range and step for a property, in its unit */
export function lengthRange(property: ChangeStyleProperty, unit: string, context: LengthContext): { min: number; max: number; step: number } {
    const [minPx, maxPx] = property === 'font-size' ? [8, 96] : property === 'border-radius' ? [0, 64] : [0, 96];
    if (property === 'font-size' && unit === '%') return { min: 50, max: 400, step: 1 };
    const size = unitSize(property, unit, context);
    if (!size || unit === 'px') return { min: minPx, max: maxPx, step: 1 };
    return { min: round(minPx / size, 2), max: round(maxPx / size, 2), step: lengthStep(unit) };
}

/** The keyboard's step for the value box: 1px, 1/16 of a rem or em, 1% */
export function lengthStep(unit: string): number {
    return unit === 'rem' || unit === 'em' ? 0.0625 : 1;
}

export const fontWeights = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export type FontWeightName = typeof fontWeights[number];

export function parseFontWeight(value: string): number | undefined {
    const text = value.trim().toLowerCase();
    if (text === 'normal') return 400;
    if (text === 'bold') return 700;
    const number = Number(text);
    return text && Number.isFinite(number) && number >= 1 && number <= 1000 ? number : undefined;
}

/** The named weight closest to a number (650 reads as Semibold) */
export function nearestFontWeight(weight: number): FontWeightName {
    return fontWeights.reduce((best, candidate) => Math.abs(candidate - weight) < Math.abs(best - weight) ? candidate : best);
}

const lengthProperties = new Set<ChangeStyleProperty>(['font-size', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-radius']);
export const isLengthProperty = (property: ChangeStyleProperty) => lengthProperties.has(property);
export const isColorProperty = (property: ChangeStyleProperty) => property === 'color' || property === 'background-color';

/**
 * Whether two values of a property look the same: colours by their channels, weights by number, lengths by
 * number in the same unit (or in px, given the element's font sizes). Anything else compares as written.
 */
export function sameStyleValue(property: ChangeStyleProperty, a: string, b: string, context?: LengthContext): boolean {
    if (a.trim() === b.trim()) return true;
    if (isColorProperty(property)) return sameColor(a, b);
    if (property === 'font-weight') {
        const first = parseFontWeight(a);
        return first !== undefined && first === parseFontWeight(b);
    }
    const first = parseLength(a);
    const second = parseLength(b);
    if (!first || !second) return a.trim().replace(/\s+/g, ' ') === b.trim().replace(/\s+/g, ' ');
    if (first.value === 0 && second.value === 0) return true;
    if (first.unit === second.unit) return Math.abs(first.value - second.value) < 1e-6;
    if (!context) return false;
    const [x, y] = [lengthToPx(first, property, context), lengthToPx(second, property, context)];
    return x !== undefined && y !== undefined && Math.abs(x - y) < 0.01;
}

/**
 * A value as the editor sends it: a bare number in a length property gets px (`18` is `18px`), so a typed
 * number is never refused for its missing unit.
 */
export function normalizeStyleValue(property: ChangeStyleProperty, value: string): string {
    const text = value.trim();
    if (!isLengthProperty(property)) return text;
    const length = parseLength(text);
    return length && !length.unit && length.value !== 0 ? `${formatNumber(length.value)}px` : text;
}
