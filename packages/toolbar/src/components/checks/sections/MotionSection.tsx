import { defineSection, ReportSection, useSection, type SectionDefinition } from './sections';

// The Accessibility panel's Motion section: animations that never end and media that plays on its own (src/checks/lazy/motion.ts).
// Not built yet: its check reports nothing, so the panel shows no section.

export const motionSection = defineSection({ id: 'motion', panel: 'accessibility', when: 'panel', run: () => undefined });

/** Every section of this area, for `PageChecks` (their reports, the background checks, the panel's indicator) */
export const motionSections: readonly SectionDefinition[] = [motionSection];

export function MotionSection() {
    return <ReportSection id={motionSection.id} title="Motion" section={useSection(motionSection)} />;
}
