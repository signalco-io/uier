import { defineSection, ReportSection, useSection, type SectionDefinition } from './sections';

// The SEO panel's Structured data section: the page's JSON-LD, its parse errors, types and missing required properties (src/checks/lazy/structuredData.ts).
// Not built yet: its check reports nothing, so the panel shows no section.

export const structuredDataSection = defineSection({ id: 'structuredData', panel: 'seo', when: 'panel', run: () => undefined });

/** Every section of this area, for `PageChecks` (their reports, the background checks, the panel's indicator) */
export const structuredDataSections: readonly SectionDefinition[] = [structuredDataSection];

export function StructuredDataSection() {
    return <ReportSection id={structuredDataSection.id} title="Structured data" section={useSection(structuredDataSection)} />;
}
