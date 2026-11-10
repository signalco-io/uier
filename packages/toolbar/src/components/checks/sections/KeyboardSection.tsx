import { useContext, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@signalco/ui-primitives/Button';
import { cx } from '@signalco/ui-primitives/cx';
import type { LazyChecks } from '../../../checks/lazy';
import type { SectionReport } from '../../../checks/lazy/api';
import type { KeyboardDetails, TabStop } from '../../../checks/lazy/keyboard';
import { useLayoutVersion } from '../../../hooks/useLayoutVersion';
import { CommentsBootstrapperContext } from '../../CommentsBootstrapperContext';
import { InkScope } from '../../InkScope';
import { CheckItem } from '../ChecksParts';
import { defineSection, ReportSection, usePageLayerVisible, useSection, type SectionDefinition } from './sections';
import { useMessages } from '../../../i18n';

// The Accessibility panel's Keyboard section (packages/toolbar/docs/page-checks-keyboard.md): the tab
// order, drawn on the page on request, and the manual focus indicator check (src/checks/lazy/keyboard.ts).

/** The on-demand checks, once the section ran: the overlay measures with them (`tabOrderLayout`) */
let lazyChecks: LazyChecks | undefined;

export const keyboardSection = defineSection({
    id: 'keyboard', panel: 'accessibility', when: 'panel',
    run: (checks, context): SectionReport<KeyboardDetails> => (lazyChecks = checks).keyboard.keyboardReport(context)
});

/** The running focus check's own cancel: closing the panel ends it (the store keeps a closed panel's checks running) */
let focusCheck: AbortController | undefined;

/** Moves the focus through the page, so only on its control's request */
export const focusSection = defineSection({
    id: 'keyboardFocus', panel: 'accessibility', when: 'manual',
    run: (checks, context) => {
        focusCheck?.abort();
        focusCheck = new AbortController();
        return checks.keyboard.checkFocusIndicators(context, focusCheck.signal);
    }
});

/** Every section of this area, for `PageChecks` (their reports, the background checks, the panel's indicator) */
export const keyboardSections: readonly SectionDefinition[] = [keyboardSection, focusSection];

/** Numbers drawn at once, at most */
const markerLimit = 100;

/**
 * The tab order on the page: each stop's number by its element and a line with an arrow to the next,
 * for the stops in the window. In the toolbar's shadow root, fixed, never taking clicks, following
 * scrolls and layout, hidden while the toolbar is collapsed. Says in the panel when it numbers fewer
 * stops than are in view.
 */
function TabOrderLayer({ stops }: { stops: readonly TabStop[] }) {
    useLayoutVersion();
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const shown = usePageLayerVisible();
    const t = useMessages().sections.keyboard;
    const layout = lazyChecks?.keyboard.tabOrderLayout(stops, markerLimit);
    if (!layout) return null;
    return <>
        {layout.inView > layout.markers.length && <p className="m-0 text-xs text-muted-foreground">{t.numbered(layout.markers.length, layout.inView)}</p>}
        {shown && rootElement && createPortal(
            <InkScope>
                <div aria-hidden="true" data-uier-tab-order="" className="pointer-events-none select-none">
                    <svg className="fixed left-0 top-0 z-[47]" width={window.innerWidth} height={window.innerHeight}>
                        {/* A light line on a dark edge: readable on any page */}
                        {(['background', 'foreground'] as const).map((tone, index) => (
                            <path key={tone} d={layout.path} fill="none" stroke={`hsl(var(--${tone}))`} strokeWidth={index ? 1.5 : 4} strokeLinecap="round" strokeLinejoin="round" />
                        ))}
                    </svg>
                    {layout.markers.map(({ n, x, y }) => (
                        <span key={n} data-uier-tab-stop={n} style={{ left: x, top: y }}
                            className="fixed z-[47] h-5 min-w-5 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-background px-1 text-center text-xs font-semibold leading-5 tabular-nums text-foreground ring-1 ring-foreground">
                            {n}
                        </span>
                    ))}
                </div>
            </InkScope>,
            rootElement
        )}
    </>;
}

const rowClassName = 'flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2';
const noteClassName = 'm-0 min-w-0 flex-1 basis-40 text-xs text-muted-foreground';
const buttonClassName = 'shrink-0 font-normal pointer-coarse:min-h-11';

export function KeyboardSection() {
    const section = useSection(keyboardSection);
    const focus = useSection(focusSection);
    const t = useMessages().sections.keyboard;
    const [showOrder, setShowOrder] = useState(false);
    const focusNote = useId();
    // Closing the panel ends a focus check still moving the focus
    useEffect(() => () => focusCheck?.abort(), []);
    const stops = section.report?.details?.stops ?? [];
    const checking = focus.status === 'checking';
    return (
        <ReportSection id={keyboardSection.id} title={t.title} section={section}>
            {stops.length > 0 && (
                <li className={rowClassName}>
                    <p className={noteClassName}>{t.orderNote}</p>
                    <Button size="xs" variant="outlined" aria-pressed={showOrder} className={cx(buttonClassName, showOrder && 'bg-accent')}
                        onClick={() => setShowOrder(!showOrder)}>
                        {t.showOrder}
                    </Button>
                    {showOrder && <TabOrderLayer stops={stops} />}
                </li>
            )}
            <li className={rowClassName}>
                <p id={focusNote} className={noteClassName}>
                    {t.focusNote}
                </p>
                <Button size="xs" variant="outlined" aria-describedby={focusNote} aria-disabled={checking || undefined} className={buttonClassName}
                    onClick={event => {
                        // So Enter can start it again from the keyboard (some browsers do not focus a clicked button)
                        event.currentTarget.focus();
                        if (!checking) focus.run();
                    }}>
                    {t.checkFocus}
                </Button>
                {focus.status !== 'idle' && (
                    // Said when it changes; once done, the result's rows show the same
                    <p role="status" className={cx('m-0 basis-full text-xs text-foreground', focus.status === 'done' && 'sr-only')}>
                        {checking ? t.moving : focus.status === 'failed' ? t.focusFailed : focus.report?.checks[0]?.reason}
                    </p>
                )}
            </li>
            {focus.report?.checks.map(check => <CheckItem key={check.id} check={check} />)}
        </ReportSection>
    );
}
