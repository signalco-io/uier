import { cssColor } from './colorValues';

export { hasTextChanges, textChangeSummary, textChanges, type TextChange, type TextChangeSummary } from './textDiff';

export const changeStyleProperties = [
    'color', 'background-color', 'font-size', 'font-weight',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-radius'
] as const;

export type ChangeStyleProperty = typeof changeStyleProperties[number];

type ChangeValue = { original: string; proposed: string };

export type ChangeProposal = {
    text?: ChangeValue;
    styles: Partial<Record<ChangeStyleProperty, ChangeValue>>;
};

export const changeProposalTextMaxLength = 1000;

/** A rewrite's quote is its selection, trimmed and cut to this many characters (the selection itself holds 2,000) */
const rewriteQuoteMaxLength = 1000;

/**
 * The text a rewrite saved without a proposal replaces, for its diff: its quote, or the full saved selection when the
 * quote is missing or was cut to the limit. The app and the toolbar resolve it the same way.
 */
export function rewriteOriginalText(selection: string | undefined, quote: string | undefined): string | undefined {
    if (!quote) return selection || undefined;
    const selected = selection?.trim();
    // The API trims the cut quote too, so it can end before the limit: a selection longer than a quote holds was cut
    return selected === quote || (selected !== undefined && selected.length > rewriteQuoteMaxLength && selected.startsWith(quote))
        ? selection : quote;
}

export function isProposalLabelHash(value: unknown): value is string {
    return typeof value === 'string' && value.length === 19 && /^v1-[\da-f]{16}$/.test(value);
}

export const changeProposalStyleMaxLength = 128;
const hexColor = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
const length = '(?:\\d{1,5}(?:\\.\\d{1,8})?|\\.\\d{1,8})(?:px|r?em|r?lh|ch|ex|cap|ic|%|[sld]?v[whib]|[sld]?vmin|[sld]?vmax|cm|mm|q|in|pt|pc)';
const lengthOrZero = `(?:0|${length})`;
const singleLength = new RegExp(`^${lengthOrZero}$`, 'i');
const radius = new RegExp(`^${lengthOrZero}(?: +${lengthOrZero}){0,3}(?: */ *${lengthOrZero}(?: +${lengthOrZero}){0,3})?$`, 'i');
const fontWeight = /^(?:normal|bold|(?:[1-9]\d{0,2})(?:\.\d{1,8})?|1000)$/i;
const unsafeText = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;

/** A rewrite message must contain visible replacement wording. An element edit can remove its copy. */
export function hasVisibleReplacement(text: string): boolean {
    return /[^\p{White_Space}\p{Cc}\p{Cf}\u115f\u1160\u3164\uffa0\u2800]/u.test(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function isChangeValue(value: unknown, isAllowed: (text: string) => boolean): value is ChangeValue {
    return isRecord(value) && Reflect.ownKeys(value).length === 2
        && Object.hasOwn(value, 'original') && Object.hasOwn(value, 'proposed')
        && typeof value.original === 'string' && typeof value.proposed === 'string'
        && value.original !== value.proposed && isAllowed(value.original) && isAllowed(value.proposed);
}

const knownProperty = (key: PropertyKey): key is ChangeStyleProperty =>
    changeStyleProperties.some(property => property === key);

/** A single literal CSS value for an allowlisted property. Computed colours use RGB or a CSS colour space. */
export function isChangeStyleValue(property: ChangeStyleProperty, value: string): boolean {
    if (!value || value.length > changeProposalStyleMaxLength || /[^\x20-\x7e]/.test(value) || value.trim() !== value) return false;
    switch (property) {
        case 'color':
        case 'background-color':
            return value.toLowerCase() === 'transparent' || hexColor.test(value) || cssColor(value) !== undefined;
        case 'font-weight': return fontWeight.test(value);
        case 'border-radius': return radius.test(value);
        default: return singleLength.test(value);
    }
}

/** Only changed pairs and known keys. Text is kept literally, including whitespace and an empty replacement. */
export function isChangeProposal(value: unknown): value is ChangeProposal {
    if (!isRecord(value) || !Object.hasOwn(value, 'styles') || !isRecord(value.styles)
        || Reflect.ownKeys(value).some(key => key !== 'text' && key !== 'styles')) return false;

    const styles = value.styles;
    const properties = Reflect.ownKeys(styles);
    const hasText = Object.hasOwn(value, 'text');
    return (hasText || properties.length > 0)
        && (!hasText || isChangeValue(value.text, text => text.length <= changeProposalTextMaxLength && !unsafeText.test(text)))
        && properties.every(key => knownProperty(key) && isChangeValue(styles[key], text => isChangeStyleValue(key, text)));
}

/** Copyable CSS declarations with a stable order, independent of the original request's key order. */
export function proposalCss(proposal: ChangeProposal, version: keyof ChangeValue = 'proposed'): string {
    return changeStyleProperties.flatMap(property => {
        const change = proposal.styles[property];
        return change ? [`${property}: ${change[version]};`] : [];
    }).join('\n');
}
