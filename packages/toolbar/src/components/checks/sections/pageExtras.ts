import type { SectionDefinition } from './sections';

// More of the SEO panel's own Page, Links and Images sections, from the on-demand checks
// (src/checks/lazy/pageExtras.ts): hreflang and viewport, generic link text, links that do not
// answer, image weight. They have no card of their own: `SeoPanel` shows their checks in its sections.
// Not built yet: no definitions.

/** Every section of this area, for `PageChecks` (their reports, the background checks, the panel's indicator) */
export const pageExtrasSections: readonly SectionDefinition[] = [];
