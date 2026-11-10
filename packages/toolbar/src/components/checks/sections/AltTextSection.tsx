import { defineSection, ReportSection, useSection, type SectionDefinition } from './sections';

// The Accessibility panel's Alt text section: every image beside its alt text, and the alt texts that say nothing (src/checks/lazy/altText.ts).
// Not built yet: its check reports nothing, so the panel shows no section.

export const altTextSection = defineSection({ id: 'altText', panel: 'accessibility', when: 'panel', run: () => undefined });

/** Every section of this area, for `PageChecks` (their reports, the background checks, the panel's indicator) */
export const altTextSections: readonly SectionDefinition[] = [altTextSection];

export function AltTextSection() {
    return <ReportSection id={altTextSection.id} title="Alt text" section={useSection(altTextSection)} />;
}
