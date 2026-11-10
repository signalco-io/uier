import { defineSection, ReportSection, useSection, type SectionDefinition } from './sections';

// The Accessibility panel's Keyboard section: the tab order on the page, and focusable elements without a visible focus indicator (src/checks/lazy/keyboard.ts).
// Not built yet: its check reports nothing, so the panel shows no section.

export const keyboardSection = defineSection({ id: 'keyboard', panel: 'accessibility', when: 'panel', run: () => undefined });

/** Every section of this area, for `PageChecks` (their reports, the background checks, the panel's indicator) */
export const keyboardSections: readonly SectionDefinition[] = [keyboardSection];

export function KeyboardSection() {
    return <ReportSection id={keyboardSection.id} title="Keyboard" section={useSection(keyboardSection)} />;
}
