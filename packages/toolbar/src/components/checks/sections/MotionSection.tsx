import { defineSection, ReportSection, useSection, type SectionDefinition } from './sections';
import { useMessages } from '../../../i18n';

// The Accessibility panel's Motion section (src/checks/lazy/motion.ts, packages/toolbar/docs/page-checks-content.md):
// what moves on its own for more than five seconds. When the panel opens: animations start late, and
// a background check would miss them.

export const motionSection = defineSection({
    id: 'motion', panel: 'accessibility', when: 'panel',
    run: (checks, context) => checks.motion.checkMotion(context)
});

/** Every section of this area, for `PageChecks` (their reports, the background checks, the panel's indicator) */
export const motionSections: readonly SectionDefinition[] = [motionSection];

export function MotionSection() {
    return <ReportSection id={motionSection.id} title={useMessages().sections.motion.title} section={useSection(motionSection)} />;
}
