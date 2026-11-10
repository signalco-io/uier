// Replaced at build time by tsup `define` (see tsup.config.ts).

/**
 * Base URL of the uier comments API, without a trailing slash. Used when the URL can not be
 * derived from the toolbar script (see src/config.ts).
 */
declare const __UIER_API_URL__: string;

/** `true` for the development build (`pnpm dev`, served from the toolbar dev server) */
declare const __UIER_DEV__: boolean;

/** Exact review bundle path and SRI, filled in after its CSS has been inlined. */
declare const __UIER_REVIEW_PATH__: string;
declare const __UIER_REVIEW_INTEGRITY__: string;

/** Exact path and SRI of the accessibility audit asset (axe-core), filled in from its final bytes. */
declare const __UIER_AUDIT_PATH__: string;
declare const __UIER_AUDIT_INTEGRITY__: string;

/**
 * Exact path and SRI of each language asset but English (`language-<code>.js`, `i18n/languageHandoff.ts`),
 * filled in from their final bytes; empty in packaged clients, which bundle the languages.
 */
declare const __UIER_LANGUAGE_ASSETS__: Partial<Record<import('./languages').ToolbarLanguage, { path: string; integrity: string }>>;
