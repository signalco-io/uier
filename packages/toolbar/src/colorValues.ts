/**
 * Colour values in text people write (`@uier/toolbar/color-values`): messages, replies and thread titles show
 * a small swatch before each one. Pure and browser/server safe; the toolbar and the app each render the
 * parts with their own `ColorText`.
 *
 * - Hex: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`.
 * - Functions: `rgb()`, `rgba()`, `hsl()`, `hsla()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()` and
 *   `color()` with a predefined colour space, in the comma and the space syntax.
 * - Never names (`red`), `var()`, `calc()`, `color-mix()` or relative colours: a name is a word, and the
 *   rest has no colour of its own.
 *
 * `color` is safe to set as a CSS value: it is written again from the checked parts (hex digits, or a
 * known function name with numbers, units, `none`, commas and one slash), never passed through.
 */

/** A piece of the text; `color` is the CSS colour it names, when it names one */
export type ColorPart = { text: string; color?: string };

/** Candidates only: every match is checked before it counts */
const candidatePattern = /#[0-9a-f]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()\n]{1,96}\)/gi;
/** A value starts the text or follows a space or punctuation, so a URL fragment, an entity or a method is none */
const joinedBefore = /[\p{L}\p{N}_#&/.@$\\-]/u;
/** `#add-comment` and `#fffx` are an id and a word */
const joinedAfter = /[\p{L}\p{N}_-]/u;

const numberSource = '[+-]?(?:\\d{1,8}(?:\\.\\d{1,8})?|\\.\\d{1,8})';
const numberPattern = new RegExp(`^${numberSource}$`);
const percentPattern = new RegExp(`^${numberSource}%$`);
const huePattern = new RegExp(`^${numberSource}(?:deg|grad|rad|turn)?$`);

type Channel = 'value' | 'percent' | 'hue';
const channelsOf = new Map<string, readonly [Channel, Channel, Channel]>([
    ['rgb', ['value', 'value', 'value']],
    ['hsl', ['hue', 'value', 'value']],
    ['hwb', ['hue', 'percent', 'percent']],
    ['lab', ['value', 'value', 'value']],
    ['oklab', ['value', 'value', 'value']],
    ['lch', ['value', 'value', 'hue']],
    ['oklch', ['value', 'value', 'hue']]
]);
const colorSpaces = new Set(['srgb', 'srgb-linear', 'display-p3', 'a98-rgb', 'prophoto-rgb', 'rec2020', 'xyz', 'xyz-d50', 'xyz-d65']);

const isValue = (token: string) => numberPattern.test(token) || percentPattern.test(token);
const isChannel = (token: string, channel: Channel) =>
    token === 'none' || (channel === 'hue' ? huePattern.test(token) : channel === 'percent' ? percentPattern.test(token) : isValue(token));

/**
 * `#389` and `#1234` are far more often a comment, an issue or a pull request than a colour. Three or four
 * decimal digits count as a colour only when they start with 0, as no number does (`#000`, `#080`), or
 * repeat one digit (`#333`, the greys).
 */
function isReference(digits: string) {
    return digits.length < 6 && /^\d+$/.test(digits) && !digits.startsWith('0') && !/^(\d)\1+$/.test(digits);
}

function hexColor(value: string): string | undefined {
    const digits = value.slice(1);
    if (![3, 4, 6, 8].includes(digits.length) || !/^[0-9a-f]+$/i.test(digits) || isReference(digits)) return undefined;
    return `#${digits.toLowerCase()}`;
}

function functionColor(value: string): string | undefined {
    const open = value.indexOf('(');
    const written = value.slice(0, open).toLowerCase();
    const body = value.slice(open + 1, -1).trim().toLowerCase();
    if (!body) return undefined;

    // The comma syntax: rgb and hsl only, without `none`, the alpha as a fourth value
    if (body.includes(',')) {
        const name = written === 'rgba' ? 'rgb' : written === 'hsla' ? 'hsl' : written;
        if (name !== 'rgb' && name !== 'hsl') return undefined;
        const tokens = body.split(',').map(token => token.trim());
        if (tokens.length < 3 || tokens.length > 4 || (tokens.length === 4 && !isValue(tokens[3]!))) return undefined;
        const [first, second, third] = tokens as [string, string, string];
        const valid = name === 'rgb'
            // All numbers or all percentages
            ? [first, second, third].every(token => numberPattern.test(token)) || [first, second, third].every(token => percentPattern.test(token))
            : huePattern.test(first) && percentPattern.test(second) && percentPattern.test(third);
        return valid ? `${name}(${tokens.join(', ')})` : undefined;
    }

    // The space syntax, the alpha after a slash
    const [channelText, alpha, ...rest] = body.split('/').map(part => part.trim());
    if (rest.length || alpha === '' || (alpha !== undefined && alpha !== 'none' && !isValue(alpha))) return undefined;
    const tokens = channelText!.split(/[ \t]+/);
    const end = alpha === undefined ? ')' : ` / ${alpha})`;
    if (written === 'color') {
        const [space, ...channels] = tokens;
        if (!colorSpaces.has(space!) || channels.length !== 3 || !channels.every(token => isChannel(token, 'value'))) return undefined;
        return `color(${tokens.join(' ')}${end}`;
    }
    const name = written === 'rgba' ? 'rgb' : written === 'hsla' ? 'hsl' : written;
    const channels = channelsOf.get(name);
    if (!channels || tokens.length !== 3 || !tokens.every((token, index) => isChannel(token, channels[index]!))) return undefined;
    return `${name}(${tokens.join(' ')}${end}`;
}

/** The CSS colour a written value names, safe to set as a style value; nothing when it is not one of the supported forms */
export function cssColor(value: string): string | undefined {
    const text = value.trim();
    return text.startsWith('#') ? hexColor(text) : /^[a-z]+\(.*\)$/is.test(text) ? functionColor(text) : undefined;
}

/** The text split at its colour values, in order; joining every `text` gives the text back */
export function colorParts(text: string): ColorPart[] {
    // Most text names no colour
    if (!text.includes('#') && !text.includes('(')) return [{ text }];
    const parts: ColorPart[] = [];
    let at = 0;
    candidatePattern.lastIndex = 0;
    for (let match = candidatePattern.exec(text); match; match = candidatePattern.exec(text)) {
        const written = match[0];
        const start = match.index;
        const end = start + written.length;
        if (start > 0 && joinedBefore.test(text[start - 1]!)) continue;
        const color = written.startsWith('#')
            ? (end < text.length && joinedAfter.test(text[end]!) ? undefined : hexColor(written))
            : functionColor(written);
        if (!color) continue;
        if (start > at) parts.push({ text: text.slice(at, start) });
        parts.push({ text: written, color });
        at = end;
    }
    if (at < text.length || !parts.length) parts.push({ text: text.slice(at) });
    return parts;
}
