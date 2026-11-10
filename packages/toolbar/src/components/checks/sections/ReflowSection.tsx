import { defineSection, ReportSection, useSection, type SectionDefinition } from './sections';

// The Accessibility panel's Zoom and text spacing section: content wider than the window, and text clipped under WCAG text spacing (src/checks/lazy/reflow.ts).
// Not built yet: its check reports nothing, so the panel shows no section.

export const reflowSection = defineSection({ id: 'reflow', panel: 'accessibility', when: 'panel', run: () => undefined });

/** Every section of this area, for `PageChecks` (their reports, the background checks, the panel's indicator) */
export const reflowSections: readonly SectionDefinition[] = [reflowSection];

export function ReflowSection() {
    return <ReportSection id={reflowSection.id} title="Zoom and text spacing" section={useSection(reflowSection)} />;
}
