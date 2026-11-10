import { useEffect, useLayoutEffect, useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { cx } from '@signalco/ui-primitives/cx';
import type { LazyChecks } from '../../../checks/lazy';
import { pageCheck } from '../../../checks/lazy/api';
import { useAnnounce } from '../../Announcer';
import { CheckItem } from '../ChecksParts';
import { defineSection, ReportSection, usePageLayerVisible, useSection, type SectionDefinition } from './sections';

// The Accessibility panel's Zoom and text spacing section (src/checks/lazy/reflow.ts,
// packages/toolbar/docs/page-checks-content.md): reflow at the window's width when the panel opens,
// and text spacing, a mode the reviewer turns on and off.

export const reflowSection = defineSection({
    id: 'reflow', panel: 'accessibility', when: 'panel',
    run: (checks, context) => checks.reflow.checkReflow(context)
});

/** The checks text spacing ran with: it takes the spacing off the page again, at once */
let spacingChecks: LazyChecks | undefined;
/** Whether the toggle still wants the spacing: a check that starts after it went off (the panel closed meanwhile) adds nothing */
let spacingWanted = false;
const removeSpacing = () => spacingChecks?.reflow.removeTextSpacing();

export const textSpacingSection = defineSection({
    id: 'textSpacing', panel: 'accessibility', when: 'manual',
    run: (checks, context) => {
        spacingChecks = checks;
        return spacingWanted ? checks.reflow.applyTextSpacing(context) : undefined;
    },
    // Its findings show only while the spacing is on, and it is off once the panel closes
    attention: () => 0
});

/** Every section of this area, for `PageChecks` (their reports, the background checks, the panel's indicator) */
export const reflowSections: readonly SectionDefinition[] = [reflowSection, textSpacingSection];

const offCheck = pageCheck('text-spacing', 'Text spacing', 'none',
    'Applies WCAG 1.4.12\'s text spacing to the page and lists text that no longer fits. It stays on while you look.');

/**
 * Text spacing: "Apply text spacing" puts the spacing on the page and measures it, and it stays on
 * while the reviewer looks. It goes off with the toggle, Check again (its report is dropped), a failed
 * or cancelled check, collapsing the toolbar, closing the panel and leaving the page (unmounted).
 */
function TextSpacingItem() {
    const section = useSection(textSpacingSection);
    const visible = usePageLayerVisible();
    const announce = useAnnounce();
    const [on, setOn] = useState(false);
    const active = on && visible && (section.status === 'checking' || section.status === 'done');
    // Before a check Check again starts reads the page
    useLayoutEffect(() => {
        if (active) return;
        spacingWanted = false;
        removeSpacing();
        setOn(false);
    }, [active]);
    useEffect(() => () => {
        spacingWanted = false;
        removeSpacing();
    }, []);
    const check = active ? section.status === 'done' && section.report?.checks[0] : undefined;
    useEffect(() => {
        if (check) announce(`Text spacing applied. ${check.value}`);
    }, [check]);
    return (
        <CheckItem check={check || (active ? { ...offCheck, reason: 'Applying text spacing...' } : offCheck)}>
            <Button size="xs" variant="outlined" aria-pressed={active}
                className={cx('ml-6 self-start pointer-coarse:min-h-11', active && 'bg-accent text-foreground')}
                onClick={() => {
                    spacingWanted = !active;
                    setOn(!active);
                    if (!active) section.run();
                }}>
                Apply text spacing
            </Button>
        </CheckItem>
    );
}

export function ReflowSection() {
    return (
        <ReportSection id={reflowSection.id} title="Zoom and text spacing" section={useSection(reflowSection)}>
            <TextSpacingItem />
        </ReportSection>
    );
}
