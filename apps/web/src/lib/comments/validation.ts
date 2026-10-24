import { z } from 'zod';
import {
    MAX_DEVICE_LABEL_LENGTH,
    MAX_REWRITE_INSTRUCTION_LENGTH,
    MAX_PATH_LENGTH,
    MAX_PIXEL_RATIO,
    MAX_QUOTED_TEXT_LENGTH,
    MAX_SELECTION_OFFSET,
    MAX_SELECTION_TEXT_LENGTH,
    MAX_SELECTOR_LENGTH,
    MAX_TEXT_LENGTH,
    MAX_WINDOW_DIMENSION
} from './limits';

// Objects strip unknown keys (zod default); wrong types fail validation.

// eslint-disable-next-line no-control-regex
const controlCharacters = /[\u0000-\u001f\u007f]/;

export const pathSchema = z.string()
    .min(1)
    .max(MAX_PATH_LENGTH)
    .refine(path => path.startsWith('/'), 'Path must start with "/"')
    .refine(path => !controlCharacters.test(path), 'Path must not contain control characters')
    .transform(normalizePath)
    // Browsers read `//host` and `/\host` as another site: a link to the comment would leave this one
    .refine(path => !path.startsWith('//') && !path.includes('\\'), 'Path must not start with "//" or contain "\\"');

/** Removes the query string, hash and trailing slashes (except for "/") */
export function normalizePath(path: string) {
    const withoutQuery = path.split(/[?#]/, 1)[0] ?? '';
    const withoutTrailingSlash = withoutQuery.replace(/\/+$/, '');
    return withoutTrailingSlash.length ? withoutTrailingSlash : '/';
}

// Bidirectional overrides and isolates can reorder how the rest of a comment reads
const bidiControls = /[\u202a-\u202e\u2066-\u2069]/g;
// At least one character that is not whitespace, a control or format character (zero-width
// spaces and joiners) or one of the blank Hangul fillers / Braille pattern
const visibleCharacter = /[^\p{White_Space}\p{Cc}\p{Cf}\u115f\u1160\u3164\uffa0\u2800]/u;

function withoutBidiControls(text: string) {
    return text.replace(bidiControls, '').trim();
}

/** Trimmed text without bidirectional overrides, with at least one visible character */
function textOf(maxLength: number) {
    return z.string()
        .transform(withoutBidiControls)
        .pipe(z.string()
            .min(1)
            .max(maxLength)
            .refine(text => visibleCharacter.test(text), 'Text must contain visible characters'));
}

export const textSchema = textOf(MAX_TEXT_LENGTH);
const quotedTextSchema = z.string()
    .transform(withoutBidiControls)
    .pipe(z.string().max(MAX_QUOTED_TEXT_LENGTH))
    .transform(text => text.length ? text : undefined);

/*
 * Selectors as the toolbar creates them (`getElementSelector` from @signalco/js): a comma-separated
 * list of `>`-chains of `#id` or `tag[.class][:nth-of-type(n)]`, identifiers escaped with a
 * backslash. Anything else (which `querySelector` could choke on in every visitor's browser) is
 * rejected.
 */
const escapedCharacter = '\\\\[^\\u0000-\\u001f\\u007f]';
const identifier = `-{0,2}(?:[A-Za-z_]|${escapedCharacter})(?:[A-Za-z0-9_-]|${escapedCharacter})*`;
const compound = `(?:#${identifier}|[A-Za-z][A-Za-z0-9-]*(?:\\.${identifier})?(?::nth-of-type\\([1-9][0-9]{0,5}\\))?)`;
const complex = `${compound}(?:>${compound})*`;
const selectorPattern = new RegExp(`^${complex}(?:,${complex})*$`, 'u');

const selectorSchema = z.string()
    .min(1)
    .max(MAX_SELECTOR_LENGTH)
    .refine(selector => selectorPattern.test(selector), 'Selector is not supported');
const normalSchema = z.number().min(0).max(1);
const offsetSchema = z.int().min(0).max(MAX_SELECTION_OFFSET);
const nodeTypeSchema = z.enum(['text', 'element']);

export const pointPositionSchema = z.object({
    type: z.literal('point'),
    selector: selectorSchema,
    xNormal: normalSchema,
    yNormal: normalSchema
});

export const selectionPositionSchema = z.object({
    type: z.literal('text'),
    text: z.string().transform(withoutBidiControls).pipe(z.string().min(1).max(MAX_SELECTION_TEXT_LENGTH)),
    startSelector: selectorSchema,
    startOffset: offsetSchema,
    startType: nodeTypeSchema,
    endSelector: selectorSchema.optional(),
    endOffset: offsetSchema,
    endType: nodeTypeSchema
});

export const pagePositionSchema = z.object({
    type: z.literal('page')
});

export const positionSchema = z.discriminatedUnion('type', [pointPositionSchema, selectionPositionSchema, pagePositionSchema]);

/**
 * Feedback and bug reports are about the page (`page` position); comments are pinned to it, and
 * rewrite suggestions (the suggested text) to the selected text they would replace
 */
export const kindSchema = z.enum(['comment', 'feedback', 'bug', 'rewrite']);

const windowDimensionSchema = z.int().min(0).max(MAX_WINDOW_DIMENSION);
const deviceLabelSchema = z.string().trim().max(MAX_DEVICE_LABEL_LENGTH)
    .transform(label => label.length ? label : undefined);

export const deviceSchema = z.object({
    size: z.enum(['desktop', 'tablet', 'mobile']).optional(),
    windowSize: z.tuple([windowDimensionSchema, windowDimensionSchema]).optional(),
    pixelRatio: z.number().min(0).max(MAX_PIXEL_RATIO).optional(),
    browser: deviceLabelSchema.optional(),
    os: deviceLabelSchema.optional()
});

export const createCommentSchema = z.object({
    path: pathSchema,
    position: positionSchema,
    kind: kindSchema.default('comment'),
    text: textSchema,
    quotedText: quotedTextSchema.optional(),
    device: deviceSchema.optional()
}).refine(
    input => {
        switch (input.kind) {
            case 'feedback':
            case 'bug': return input.position.type === 'page';
            case 'rewrite': return input.position.type === 'text';
            default: return input.position.type !== 'page';
        }
    },
    { path: ['position'], message: 'Comments are pinned to an element or text, rewrite suggestions to text; feedback and bug reports are about the page' });

/**
 * `POST /api/rewrite`: selected page text and an optional instruction ("shorter", "friendlier").
 * The text is at most what a rewrite comment holds (its quoted original and its suggested text).
 */
export const rewriteRequestSchema = z.object({
    text: textOf(MAX_TEXT_LENGTH),
    instruction: z.string()
        .transform(withoutBidiControls)
        .pipe(z.string().max(MAX_REWRITE_INSTRUCTION_LENGTH))
        .transform(text => text.length ? text : undefined)
        .optional()
});

export const replySchema = z.object({
    text: textSchema
});

export const updateCommentSchema = z.object({
    resolved: z.boolean()
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type ReplyInput = z.infer<typeof replySchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;

/** Ids generated by the server (`comment_<nanoid>`, `item_<nanoid>`) and old client-generated item ids (`0.123...`) */
const idPattern = /^[A-Za-z0-9_.:-]{1,128}$/;

export function isValidId(id: string) {
    return idPattern.test(id);
}

/** Human readable summary of the first validation issue (no echo of the submitted values) */
export function describeValidationError(error: z.ZodError, rootName = 'body') {
    const issue = error.issues[0];
    if (!issue)
        return 'Invalid request.';

    const field = issue.path.length ? issue.path.join('.') : rootName;
    if (issue.code === 'too_big') {
        if (issue.origin === 'string')
            return `"${field}" is too long (maximum ${String(issue.maximum)} characters).`;
        if (issue.origin === 'array')
            return `"${field}" has too many items (maximum ${String(issue.maximum)}).`;
        return `"${field}" must be at most ${String(issue.maximum)}.`;
    }
    if (issue.code === 'too_small') {
        if (issue.origin === 'string')
            return Number(issue.minimum) <= 1 ? `"${field}" must not be empty.` : `"${field}" is too short (minimum ${String(issue.minimum)} characters).`;
        if (issue.origin === 'array')
            return `"${field}" has too few items (minimum ${String(issue.minimum)}).`;
        return `"${field}" must be at least ${String(issue.minimum)}.`;
    }
    return `"${field}" is invalid: ${issue.message}`;
}
