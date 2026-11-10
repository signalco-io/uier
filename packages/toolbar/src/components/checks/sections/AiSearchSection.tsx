import { defineSection, ReportSection, useSection, type SectionDefinition } from './sections';

// The SEO panel's AI search section: what an AI reads of the page, citable facts and AI suggestions (src/checks/lazy/aiSearch.ts).
// Not built yet: its check reports nothing, so the panel shows no section.

export const aiSearchSection = defineSection({ id: 'aiSearch', panel: 'seo', when: 'panel', run: () => undefined });

/** Every section of this area, for `PageChecks` (their reports, the background checks, the panel's indicator) */
export const aiSearchSections: readonly SectionDefinition[] = [aiSearchSection];

export function AiSearchSection() {
    return <ReportSection id={aiSearchSection.id} title="AI search" section={useSection(aiSearchSection)} />;
}
