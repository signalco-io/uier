import { defineSection, ReportSection, useSection, type SectionDefinition } from './sections';

// The Accessibility panel's Screen reader section: landmarks, headings and controls with their accessible names (src/checks/lazy/screenReader.ts).
// Not built yet: its check reports nothing, so the panel shows no section.

export const screenReaderSection = defineSection({ id: 'screenReader', panel: 'accessibility', when: 'panel', run: () => undefined });

/** Every section of this area, for `PageChecks` (their reports, the background checks, the panel's indicator) */
export const screenReaderSections: readonly SectionDefinition[] = [screenReaderSection];

export function ScreenReaderSection() {
    return <ReportSection id={screenReaderSection.id} title="Screen reader" section={useSection(screenReaderSection)} />;
}
