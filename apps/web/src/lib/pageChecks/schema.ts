import { z } from 'zod';
import { reviewPathSchema } from '../comments/validation';
import {
    checkKeyPattern,
    PAGE_CHECK_DESCRIPTION_MAX,
    PAGE_CHECK_MAX_CHECKS,
    PAGE_CHECK_MAX_COUNT,
    PAGE_CHECK_TITLE_MAX
} from './model';

// `POST /api/review/<code>/page-checks` (docs/api.md, "Page checks"): one page's summary from the
// toolbar. Strict objects with bounded numbers, strings and map sizes, so nothing beyond the page's
// title and description is free text, and nothing names an element, the page's text or the reviewer.

const count = z.int().min(0).max(PAGE_CHECK_MAX_COUNT);

/** One line of plain text: no control characters (the toolbar sends it as one line) */
const plainText = (max: number) => z.string().trim().min(1).max(max)
    .refine(text => !/[\p{Cc}]/u.test(text), 'Send plain text on one line.');

const checksSchema = z.record(z.string().regex(checkKeyPattern, 'Unknown check id.'), z.enum(['pass', 'warn', 'none']))
    .refine(checks => Object.keys(checks).length <= PAGE_CHECK_MAX_CHECKS, `Send at most ${PAGE_CHECK_MAX_CHECKS} checks.`);

export const pageCheckInputSchema = z.object({
    /** The canonical page key, as the toolbar's comments send it; the project's page-state policy applies again */
    path: reviewPathSchema,
    sourcePath: reviewPathSchema.optional(),
    title: plainText(PAGE_CHECK_TITLE_MAX).optional(),
    description: plainText(PAGE_CHECK_DESCRIPTION_MAX).optional(),
    noindex: z.boolean(),
    accessibility: z.object({ critical: count, serious: count, moderate: count, minor: count }).strict().optional(),
    seo: z.object({ warn: count, pass: count }).strict(),
    checks: checksSchema,
    vitals: z.object({
        lcp: z.number().min(0).max(600_000).optional(),
        cls: z.number().min(0).max(100).optional(),
        inp: z.number().min(0).max(600_000).optional()
    }).strict().optional()
}).strict();

export type PageCheckInput = z.output<typeof pageCheckInputSchema>;
