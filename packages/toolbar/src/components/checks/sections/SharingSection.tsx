import { defineSection, ReportSection, useSection, type SectionDefinition } from './sections';

// The SEO panel's Sharing section: Open Graph and X card tags, the search result snippet and the shared image (src/checks/lazy/sharing.ts).
// Not built yet: its check reports nothing, so the panel shows no section.

export const sharingSection = defineSection({ id: 'sharing', panel: 'seo', when: 'panel', run: () => undefined });

/** Every section of this area, for `PageChecks` (their reports, the background checks, the panel's indicator) */
export const sharingSections: readonly SectionDefinition[] = [sharingSection];

export function SharingSection() {
    return <ReportSection id={sharingSection.id} title="Sharing" section={useSection(sharingSection)} />;
}
