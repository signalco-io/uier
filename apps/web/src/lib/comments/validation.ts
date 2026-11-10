import { z } from 'zod';
import { feedbackTypeIdSchema } from '../app/feedbackTypeSchema';
import { maxPageKeyLength } from '@uier/toolbar/page-state';
import { commentCheckCountMax, commentCheckIdPattern, commentCheckTypes } from '@uier/toolbar/feedback-types';
import { feedbackStatusTargets } from '@uier/toolbar/verification';
import { pageLanguagePattern } from '@uier/toolbar/devices';
import { MAX_SCREENSHOT_DATA_URL_LENGTH, parseScreenshot, sanitizeScreenshot } from './screenshot';
import {
    MAX_DEVICE_LABEL_LENGTH,
    MAX_LAYER_LABEL_LENGTH,
    MAX_NESTED_OPENERS,
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

/** Projects filter meaningful state using their policy after parsing; never accept an absolute URL. */
export const reviewPathSchema = z.string().min(1).max(maxPageKeyLength)
    .refine(path => path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') && !controlCharacters.test(path), 'Use a relative page path.');

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
export function textOf(maxLength: number) {
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
 * Selectors as the toolbar creates them: comma-separated child chains of ids or tags with a
 * class, exact semantic/identity attributes and nth-of-type. Keep legacy selectors valid and
 * reject arbitrary attributes, operators, pseudo-classes and shadow boundaries.
 */
const escapedCharacter = '\\\\[^\\u0000-\\u001f\\u007f]';
const identifier = `-{0,2}(?:[A-Za-z_]|${escapedCharacter})(?:[A-Za-z0-9_-]|${escapedCharacter})*`;
const attributeName = '(?:role|aria-label|data-(?:testid|test-id|test|cy|qa|anchor|id|key|slot|component))';
const attributeValue = `(?:[^"\\\\\\u0000-\\u001f\\u007f]|${escapedCharacter})*`;
const attribute = `\\[${attributeName}="${attributeValue}"\\]`;
const compound = `(?:#${identifier}|[A-Za-z][A-Za-z0-9-]*(?:\\.${identifier})?(?:${attribute}){0,2}(?::nth-of-type\\([1-9][0-9]{0,5}\\))?)`;
const complex = `${compound}(?:>${compound})*`;
// A single explicit boundary for anchors on uier's own toolbar; the inner CSS stays restricted.
const toolbarAnchorPrefix = '#uier-toolbar>>>';
const selectorPattern = new RegExp(`^(?:#uier-toolbar>>>)?${complex}(?:,${complex})*$`, 'u');

const selectorSchema = z.string()
    .min(1)
    .max(MAX_SELECTOR_LENGTH)
    .refine(selector => selectorPattern.test(selector), 'Selector is not supported');
const normalSchema = z.number().min(0).max(1);
const areaSizeSchema = z.number().gt(0).max(1);
/** Rounding room for an area that ends at its element's edge */
const areaTolerance = 1e-6;
const offsetSchema = z.int().min(0).max(MAX_SELECTION_OFFSET);
const nodeTypeSchema = z.enum(['text', 'element']);

/**
 * The anchor is in a menu, popover or dialog that a page element opens: that element (a selector like
 * the anchor's) and its name, so a closed menu's comment can be shown on the button that opens it.
 * On uier's own pages a toolbar layer inside another adds `nested`: the toolbar buttons that open the
 * inner layers, outside in (packages/toolbar/docs/toolbar-review.md).
 */
const layerSchema = z.object({
    opener: selectorSchema,
    label: textOf(MAX_LAYER_LABEL_LENGTH).optional(),
    nested: z.array(selectorSchema.refine(selector => selector.startsWith(toolbarAnchorPrefix), 'Nested openers are toolbar buttons'))
        .min(1).max(MAX_NESTED_OPENERS).optional()
}).refine(layer => !layer.nested || layer.opener.startsWith(toolbarAnchorPrefix), 'Nested openers are inside a toolbar opener');

/** A point on an element; with a width and a height, an area dragged over it (the point its top-left corner) */
export const pointPositionSchema = z.object({
    type: z.literal('point'),
    selector: selectorSchema,
    xNormal: normalSchema,
    yNormal: normalSchema,
    widthNormal: areaSizeSchema.optional(),
    heightNormal: areaSizeSchema.optional(),
    layer: layerSchema.optional()
})
    .refine(point => (point.widthNormal === undefined) === (point.heightNormal === undefined), 'An area needs a width and a height')
    .refine(point => point.widthNormal === undefined || point.heightNormal === undefined
        || (point.xNormal + point.widthNormal <= 1 + areaTolerance && point.yNormal + point.heightNormal <= 1 + areaTolerance),
    'An area must be within its element');

export const selectionPositionSchema = z.object({
    type: z.literal('text'),
    text: z.string().transform(withoutBidiControls).pipe(z.string().min(1).max(MAX_SELECTION_TEXT_LENGTH)),
    startSelector: selectorSchema,
    startOffset: offsetSchema,
    startType: nodeTypeSchema,
    endSelector: selectorSchema.optional(),
    endOffset: offsetSchema,
    endType: nodeTypeSchema,
    layer: layerSchema.optional()
});

export const pagePositionSchema = z.object({
    type: z.literal('page')
});

export const positionSchema = z.discriminatedUnion('type', [pointPositionSchema, selectionPositionSchema, pagePositionSchema]);

/**
 * Whether a position points into uier's own toolbar (its anchor or the opener of its layer). Only
 * uier's own pages review the toolbar: the review API refuses these from a project's sites.
 */
export function isToolbarPosition(position: z.infer<typeof positionSchema>) {
    if (position.type === 'page') return false;
    const selectors = position.type === 'point'
        ? [position.selector]
        : [position.startSelector, position.endSelector];
    return [...selectors, position.layer?.opener, ...position.layer?.nested ?? []].some(selector => selector?.startsWith(toolbarAnchorPrefix));
}

export const reattachAnchorSchema = z.object({
    path: reviewPathSchema,
    position: z.discriminatedUnion('type', [pointPositionSchema, selectionPositionSchema]),
    expectedRevision: z.string().min(1).max(128).nullable()
});
export type ReattachAnchorInput = z.infer<typeof reattachAnchorSchema>;

/**
 * Feedback and bug reports are about the page (`page` position); comments are pinned to it, and
 * rewrite suggestions (the suggested text) to the selected text they would replace
 */
export const kindSchema = z.union([z.enum(['comment', 'rewrite']), feedbackTypeIdSchema]);

/**
 * The page check a comment was posted from: a known kind of check and its rule or check id, and for
 * one comment about several of its elements, how many (2 to `commentCheckCountMax`); nothing else
 */
export const checkSchema = z.object({
    type: z.enum(commentCheckTypes),
    id: z.string().regex(commentCheckIdPattern),
    count: z.int().min(2).max(commentCheckCountMax).optional()
}).strict();

const windowDimensionSchema = z.int().min(0).max(MAX_WINDOW_DIMENSION);
// Control and format characters (zero-width, bidirectional) never belong in a browser or model name
const deviceLabelSchema = z.string().transform(label => label.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(MAX_DEVICE_LABEL_LENGTH))
    .transform(label => label.length ? label : undefined);

/**
 * What the toolbar parsed in the reviewer's browser (`getDeviceInfo`). Fields added later are dropped
 * when a value is not one this version knows (an older server, a newer toolbar), never failing the
 * comment; unknown keys, a user-agent string among them, are stripped.
 */
export const deviceSchema = z.object({
    capturedAt: z.iso.datetime().optional(),
    size: z.enum(['desktop', 'tablet', 'mobile']).optional(),
    windowSize: z.tuple([windowDimensionSchema, windowDimensionSchema]).optional(),
    pixelRatio: z.number().min(0).max(MAX_PIXEL_RATIO).optional(),
    browser: deviceLabelSchema.optional(),
    os: deviceLabelSchema.optional(),
    model: deviceLabelSchema.optional().catch(undefined),
    input: z.enum(['touch', 'mouse']).optional().catch(undefined),
    colorScheme: z.enum(['light', 'dark']).optional().catch(undefined),
    reducedMotion: z.boolean().optional().catch(undefined),
    pageLanguage: z.string().regex(pageLanguagePattern).optional().catch(undefined)
});

/**
 * A screenshot of the commented part of the page, as a data URL. Its type and size are read from
 * the image (screenshot.ts), never taken from the client.
 */
export const screenshotSchema = z.string()
    .max(MAX_SCREENSHOT_DATA_URL_LENGTH)
    .transform(async (value, ctx) => {
        const header = parseScreenshot(value);
        const parsed = typeof header === 'string' ? header : await sanitizeScreenshot(header);
        if (typeof parsed === 'string') {
            ctx.addIssue({ code: 'custom', message: parsed });
            return z.NEVER;
        }
        return parsed;
    });

export const replaceScreenshotSchema = z.object({
    screenshot: screenshotSchema,
    expectedRevision: z.string().min(1).max(128).nullable()
});
export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);

export const createCommentSchema = z.object({
    idempotencyKey: idempotencyKeySchema.optional(),
    path: pathSchema,
    /** The page's own address for links (`/plans/`), filtered like `path`; ignored when it is another page */
    sourcePath: reviewPathSchema.optional(),
    position: positionSchema,
    kind: kindSchema.default('comment'),
    text: textSchema,
    quotedText: quotedTextSchema.optional(),
    check: checkSchema.optional(),
    device: deviceSchema.optional(),
    screenshot: screenshotSchema.optional()
}).refine(
    input => {
        switch (input.kind) {
            case 'feedback':
            case 'bug': return input.position.type === 'page';
            case 'rewrite': return input.position.type === 'text';
            case 'comment': return input.position.type !== 'page';
            default: return input.position.type === 'page';
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
    idempotencyKey: idempotencyKeySchema.optional(),
    screenshot: screenshotSchema.optional(),
    text: textSchema
});

export const editThreadItemSchema = z.object({
    text: textSchema,
    // Exact saved text when editing started; never normalize away a concurrent difference.
    expectedText: z.string().max(MAX_TEXT_LENGTH)
});
export type EditThreadItemInput = z.infer<typeof editThreadItemSchema>;

/** Exactly one operation; archive never changes the workflow status. */
export const updateCommentSchema = z.object({
    archived: z.boolean().optional(),
    resolved: z.boolean().optional(),
    status: z.enum(feedbackStatusTargets).optional()
}).refine(input => [input.resolved, input.status, input.archived].filter(value => value !== undefined).length === 1, 'Send exactly one of resolved, status or archived.');

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
