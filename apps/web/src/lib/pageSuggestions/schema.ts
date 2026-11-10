import { z } from 'zod';
import { textOf } from '../comments/validation';

// AI suggestions for a page (the toolbar's SEO panel, "AI search"): what the toolbar may send and
// what an answer may hold. docs/api.md, "Page suggestions".

export const pageSuggestionKinds = ['title', 'description', 'questions'] as const;
export type PageSuggestionKind = typeof pageSuggestionKinds[number];

/** The page's main text: the first characters of its Markdown, as the toolbar reads it */
export const MAX_PAGE_TEXT_LENGTH = 4000;
/** The page's current title and meta description, as context */
export const MAX_PAGE_TITLE_LENGTH = 200;
export const MAX_PAGE_DESCRIPTION_LENGTH = 500;

/**
 * What a suggestion may be, in characters: a title and a description within the SEO panel's own
 * ranges (so a suggestion passes its checks), a question one line. Anything else is dropped, never cut.
 */
export const pageSuggestionBounds: Record<PageSuggestionKind, { min: number; max: number }> = {
    title: { min: 10, max: 60 },
    description: { min: 50, max: 160 },
    questions: { min: 10, max: 150 }
};

/**
 * `POST /api/page-suggestions` (and a project's `POST /api/review/<code>/page-suggestions`): which
 * suggestions, the page's text and its current title and description. Strict: other fields are refused.
 */
export const pageSuggestionsRequestSchema = z.strictObject({
    kind: z.enum(pageSuggestionKinds),
    text: textOf(MAX_PAGE_TEXT_LENGTH),
    title: textOf(MAX_PAGE_TITLE_LENGTH).optional(),
    description: textOf(MAX_PAGE_DESCRIPTION_LENGTH).optional()
});
export type PageSuggestionsInput = z.output<typeof pageSuggestionsRequestSchema>;
