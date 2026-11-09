import { cx } from '@signalco/ui-primitives/cx';
import type { ChecksAttention, ChecksPanelId } from './PageChecks';

const panelNames: Record<ChecksPanelId, string> = { accessibility: 'Accessibility', seo: 'SEO' };

/**
 * A checks button's accessible name: the panel, then what its background check found to act on
 * ("Accessibility, 3 issues found", "SEO, 2 to look at"), like the inbox names its unread threads
 */
export function checksButtonLabel(panel: ChecksPanelId, attention?: ChecksAttention) {
    const count = attention?.[panel];
    if (!count) return panelNames[panel];
    return panel === 'accessibility'
        ? `${panelNames[panel]}, ${count} ${count === 1 ? 'issue' : 'issues'} found`
        : `${panelNames[panel]}, ${count} to look at`;
}

/**
 * The small amber dot on a checks button (or its Options row) while its report of this page found
 * something to act on. Decorative: the button's name says it.
 */
export function AttentionDot({ panel, attention, className }: { panel: ChecksPanelId; attention?: ChecksAttention; className?: string }) {
    if (!attention?.[panel]) return null;
    return (
        <span
            aria-hidden="true"
            data-uier-attention={panel}
            className={cx('pointer-events-none size-2 rounded-full bg-[hsl(var(--brand-warning))] ring-2 ring-[hsl(var(--background))]', className)} />
    );
}
