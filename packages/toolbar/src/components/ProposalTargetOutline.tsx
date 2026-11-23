import { cx } from '@uier/ui-primitives/cx';
import { useMessages } from '../i18n';
import { InkScope } from './InkScope';

/**
 * The element a suggestion changes, while its editor or thread is open: a dashed outline (the accent's, like an
 * area's) that follows the preview, and a badge with its tag and how many changes it has. Clicks go to the page.
 */
export function ProposalTargetOutline({ rect, tag, count, className }: { rect: DOMRect; tag?: string; count: number; className?: string }) {
    const t = useMessages().proposal;
    // Above the element, or inside its top edge when the window has no room above it
    const badgeAbove = rect.top >= 28;
    return (
        <div aria-hidden="true" data-uier-proposal-target=""
            className={cx('pointer-events-none fixed select-none rounded-[3px] outline-dashed outline-1 outline-offset-4 outline-[hsl(var(--brand-accent))]', className)}
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, willChange: 'left, top' }}>
            {/* Ink in either theme, like the pins */}
            {(tag || count > 0) && <InkScope><span className="absolute left-[-5px] whitespace-nowrap rounded-md bg-background px-1.5 py-0.5 text-[11px] font-medium leading-4 text-foreground"
                style={badgeAbove ? { bottom: 'calc(100% + 8px)' } : { top: 4 }}>
                {tag && <span className="font-mono">{tag}</span>}
                {tag && count > 0 && ' · '}
                {count > 0 && t.changeCount(count)}
            </span></InkScope>}
        </div>
    );
}
