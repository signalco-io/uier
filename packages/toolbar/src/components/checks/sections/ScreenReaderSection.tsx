import { useContext, useId, useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { cx } from '@signalco/ui-primitives/cx';
import { Down, MyLocation } from '@signalco/ui-icons';
import { withAxe } from '../../../checks/accessibility';
import type { OutlineItem } from '../../../checks/lazy/screenReader';
import { IconTooltip } from '../../IconTooltip';
import { ChecksContext } from '../ChecksParts';
import { defineSection, ReportSection, useSection, type SectionDefinition } from './sections';
import { useMessages } from '../../../i18n';

// The Accessibility panel's Screen reader section (packages/toolbar/docs/page-checks-keyboard.md):
// landmarks, headings and controls in reading order with their roles, names and states, from
// axe-core's own functions on its virtual tree (src/checks/lazy/screenReader.ts).

export const screenReaderSection = defineSection({
    id: 'screenReader', panel: 'accessibility', when: 'panel',
    // axe-core's virtual tree: one thing at a time with the panel's audit
    run: (checks, context) => withAxe(axe => checks.screenReader.screenReaderOutline(axe, context), context.signal)
});

/** Every section of this area, for `PageChecks` (their reports, the background checks, the panel's indicator) */
export const screenReaderSections: readonly SectionDefinition[] = [screenReaderSection];

/** Items listed before "Show all" */
const firstItems = 50;

/** One landmark, heading or control: its role (or heading level) in mono, its name and states, and Highlight */
function OutlineEntry({ item }: { item: OutlineItem }) {
    const { highlighted, highlight } = useContext(ChecksContext);
    const t = useMessages();
    const id = useId();
    const pressed = highlighted === item.key;
    return (
        <li className="flex min-w-0 items-center gap-2 text-sm" style={{ paddingLeft: `${item.depth * 12}px` }}>
            <span id={id} className="min-w-0 flex-1 break-words">
                <span className="font-mono text-xs text-muted-foreground">{item.level ? `h${item.level}` : item.role}</span>{' '}
                <span className={item.name ? 'text-secondary-foreground' : 'italic text-muted-foreground'}>{item.name || t.sections.screenReader.noName}</span>
                {item.states.length > 0 && <span className="text-xs text-muted-foreground">, {item.states.join(', ')}</span>}
            </span>
            <IconTooltip label={t.checks.highlight}>
                <IconButton size="xs" variant="plain" aria-label={t.checks.highlight} aria-pressed={pressed} aria-describedby={id}
                    className={cx('shrink-0 text-muted-foreground hover:text-foreground pointer-coarse:size-11', pressed && 'bg-accent text-foreground')}
                    onClick={() => highlight({ key: item.key, element: item.element, summary: item.name, comment: '', check: { type: 'accessibility', id: 'sr-outline' } })}>
                    <MyLocation size={14} aria-hidden="true" />
                </IconButton>
            </IconTooltip>
        </li>
    );
}

/** A folded list, like the SEO panel's heading outline, the first items and then all of them */
function OutlineList({ label, items }: { label: string; items: readonly OutlineItem[] }) {
    const [all, setAll] = useState(false);
    const t = useMessages();
    if (!items.length) return null;
    const shown = all ? items : items.slice(0, firstItems);
    return (
        <li className="px-3 py-1">
            <details className="group">
                <summary className="-mx-1 flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-md px-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
                    <Down size={16} aria-hidden="true" className="-rotate-90 group-open:rotate-0" />
                    {label} <span className="tabular-nums">{items.length}</span>
                </summary>
                <ol aria-label={label} className="m-0 flex list-none flex-col gap-0.5 p-0 pb-2 pl-6">
                    {shown.map(item => <OutlineEntry key={item.key} item={item} />)}
                </ol>
                {items.length > shown.length && (
                    <Button size="xs" variant="plain" className="mb-2 ml-5 text-muted-foreground hover:text-foreground pointer-coarse:min-h-11" onClick={() => setAll(true)}>
                        {t.checks.showAll(items.length)}
                    </Button>
                )}
            </details>
        </li>
    );
}

export function ScreenReaderSection() {
    const section = useSection(screenReaderSection);
    const details = section.report?.details;
    const t = useMessages().sections.screenReader;
    return (
        <ReportSection id={screenReaderSection.id} title={t.title} section={section}>
            {details && <>
                <OutlineList label={t.structure} items={details.structure} />
                <OutlineList label={t.controls} items={details.controls} />
            </>}
        </ReportSection>
    );
}
