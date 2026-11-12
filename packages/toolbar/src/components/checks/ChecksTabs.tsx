import { useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Info } from '@signalco/ui-icons';
import { useIconTooltip } from '../IconTooltip';
import { cx } from '@signalco/ui-primitives/cx';
import { useRovingFocus } from '../../focusKeys';
import type { ChecksPanelId } from './PageChecks';
import { useMessages } from '../../i18n';

export type ChecksTab = {
    /** Also `data-uier-tab` on its tab and `data-uier-tab-panel` on its panel */
    id: string;
    label: string;
    /** What its sections found to act on: a dot on the tab, and the count in its name */
    attention: number;
    content: ReactNode;
    /** What the tab's checks can and cannot see: behind an info button at the end of the tab row, not a paragraph in the tab */
    about?: { label: string; text: string; /** `data-uier-<marker>` on the text, for tests */ marker?: string };
};

/** The info button at the end of the tab row: the chosen tab's limits in a tooltip (also on a tap), and its description */
function TabAbout({ about }: { about: NonNullable<ChecksTab['about']> }) {
    const textId = useId();
    const { triggerProps, tooltip } = useIconTooltip(about.text, undefined, { tap: true, prose: true });
    return <>
        <IconButton size="xs" variant="plain" aria-label={about.label} aria-describedby={textId} data-uier-tab-about=""
            className="size-6 shrink-0 text-muted-foreground hover:text-foreground pointer-coarse:size-11" {...triggerProps}>
            <Info size={14} aria-hidden="true" />
        </IconButton>
        {tooltip}
        <span id={textId} hidden {...about.marker ? { [`data-uier-${about.marker}`]: '' } : {}}>{about.text}</span>
    </>;
}

/**
 * Each panel's last tab, in module memory: a panel that opens again, or stays open on the next page
 * (a client-side navigation remounts it), shows the same tab; a full page load starts at the first
 */
const lastTabs = new Map<ChecksPanelId, string>();

// The inbox's status tabs' look (`CommentsStatusTabs`): underlined, the chosen one in the foreground
const tabClassName = '-mb-px gap-1.5 rounded-none border-b-2 px-0.5 hover:bg-transparent active:bg-transparent pointer-coarse:h-11 pointer-coarse:min-w-11';
const tabStateClassName = (selected: boolean) => selected ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground';

/**
 * A checks panel's sections in a few tabs, so a long report is not one long scroll: one tab stop,
 * ← and → move between them and show the one they reach. A tab whose sections found something to act
 * on has the amber dot of the pill's button, and its name says what ("Keyboard, 2 issues found").
 * Every tab's content stays rendered (hidden), so what it shows (Show all, an open outline, a tab
 * order on the page) stays while another tab is open. While a summary tile filters the results
 * (`filtered`), the tabs give way to every tab's matching results in one list.
 */
export function ChecksTabs({ panel, label, tabs, filtered }: {
    panel: ChecksPanelId;
    /** The tab list's name */
    label: string;
    tabs: readonly ChecksTab[];
    filtered: boolean;
}) {
    const t = useMessages();
    const baseId = useId();
    const [selected, setSelectedState] = useState(() => lastTabs.get(panel) ?? tabs[0]?.id);
    const setSelected = (id: string) => {
        lastTabs.set(panel, id);
        setSelectedState(id);
    };
    const current = tabs.some(tab => tab.id === selected) ? selected : tabs[0]?.id;
    const ref = useRef<HTMLDivElement>(null);
    const roving = useRovingFocus(ref, { orientation: 'horizontal', preferred: () => ref.current?.querySelector<HTMLElement>('[aria-selected="true"]') });
    const tabId = (id: string) => `${baseId}-tab-${id}`;
    const panelId = (id: string) => `${baseId}-panel-${id}`;
    return <>
        {!filtered && (
            // Its line runs across the whole panel (out of its 16 px padding), between the panel's header and its
            // content, and its sections sit closer to it than the panel's other parts are to each other. It sits close
            // under the summary too: the tabs' own height already spaces their names from the tiles
            <div className="-mx-4 -mb-4 -mt-2 flex items-center gap-2 border-b px-4">
            <div ref={ref} role="tablist" aria-label={label} data-uier-tabs={panel} className="flex min-w-0 flex-1 flex-wrap gap-x-3"
                onFocus={roving.onFocus} onKeyDown={roving.onKeyDown}>
                {tabs.map(tab => {
                    const active = tab.id === current;
                    return (
                        <Button key={tab.id} id={tabId(tab.id)} role="tab" aria-selected={active} aria-controls={panelId(tab.id)} data-uier-tab={tab.id}
                            aria-label={tab.attention ? (panel === 'accessibility' ? t.checks.attentionIssues : t.checks.attentionLook)(tab.label, tab.attention) : undefined}
                            size="sm" variant="plain" className={cx(tabClassName, tabStateClassName(active))}
                            // The arrow keys move the focus, and the tab it reaches shows
                            onFocus={() => setSelected(tab.id)}
                            onClick={() => setSelected(tab.id)}>
                            {tab.label}
                            {tab.attention > 0 && <span aria-hidden="true" data-uier-tab-attention="" className="size-2 shrink-0 rounded-full bg-[hsl(var(--brand-warning))]" />}
                        </Button>
                    );
                })}
            </div>
            {/* Outside the tab list (its arrows move between tabs only); the tab's own Tab stop after it */}
            {(() => { const about = tabs.find(tab => tab.id === current)?.about; return about && <TabAbout key={current} about={about} />; })()}
            </div>
        )}
        {tabs.map(tab => (
            // Filtered, each tab's sections are the panel's own rows, as without tabs
            <div key={tab.id} id={panelId(tab.id)} data-uier-tab-panel={tab.id}
                role={filtered ? undefined : 'tabpanel'} aria-labelledby={filtered ? undefined : tabId(tab.id)}
                hidden={!filtered && tab.id !== current}
                className={filtered ? 'contents' : 'flex min-w-0 flex-col gap-6'}>
                {tab.content}
            </div>
        ))}
    </>;
}
