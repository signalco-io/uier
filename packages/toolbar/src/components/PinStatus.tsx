import { cx } from '@signalco/ui-primitives/cx';
import type { FeedbackStage } from '../verification';

/**
 * Each status's dot on the pin and the soft halo of its colour behind it (BRAND.md, "Status"), like the glowing
 * dots of the app's board column headers (`GlowingStateDot`, kept subtle in uier #399), scaled for the pin (uier #408).
 */
const pinStatusColors: Record<Exclude<FeedbackStage, 'open'>, { dot: string; glow: string }> = {
    'in-progress': { dot: 'bg-[hsl(var(--brand-in-progress))]', glow: 'bg-[hsl(var(--brand-in-progress)/0.35)]' },
    ready: { dot: 'bg-[hsl(var(--brand-ready))]', glow: 'bg-[hsl(var(--brand-ready)/0.35)]' },
    done: { dot: 'bg-[hsl(var(--brand-success))]', glow: 'bg-[hsl(var(--brand-success)/0.35)]' }
};

/**
 * A thread's status on its pin (uier #364): a solid 8 px dot in the status's colour with a white ring like the pin's
 * and a soft halo of its colour, on the pin's round top-right edge, the corner the sharp tip leaves free, above the
 * message count on the bottom-right (uier #397, #408). Ink like the pin, so the dark tokens whatever the theme; the
 * white ring keeps it readable on any page. The halo takes no room. Open says nothing; the pin's name says the
 * status. Decorative.
 */
export function PinStatus({ stage }: { stage: Exclude<FeedbackStage, 'open'> }) {
    const colors = pinStatusColors[stage];
    return (
        <span
            aria-hidden="true"
            data-uier-pin-status={stage}
            className="dark pointer-events-none absolute -right-px -top-px flex size-2 items-center justify-center">
            <span className={cx('absolute size-4 rounded-full blur-[2.5px]', colors.glow)} />
            <span className={cx('relative size-2 rounded-full ring-[1.5px] ring-foreground', colors.dot)} />
        </span>
    );
}
