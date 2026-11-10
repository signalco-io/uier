import { defineSection, ReportSection, useSection, type SectionDefinition } from './sections';
import { useMessages } from '../../../i18n';

// The SEO panel's Structured data section: the page's JSON-LD, its parse errors, types and the properties
// their documentation requires; microdata and RDFa counted (src/checks/lazy/structuredData.ts,
// packages/toolbar/docs/page-checks-seo-head.md). Bounded reading without a request: in the background.

export const structuredDataSection = defineSection({
    id: 'structuredData', panel: 'seo', when: 'background',
    run: (checks, context) => checks.structuredData.checkStructuredData(context)
});

/** Every section of this area, for `PageChecks` (their reports, the background checks, the panel's indicator) */
export const structuredDataSections: readonly SectionDefinition[] = [structuredDataSection];

export function StructuredDataSection() {
    return <ReportSection id={structuredDataSection.id} title={useMessages().sections.structuredData.title} section={useSection(structuredDataSection)} />;
}
