import { cx } from '@signalco/ui-primitives/cx';
import type { FeedbackStage } from '../verification';

/**
 * Each status's dot on the pin and the soft halo of its colour behind it (BRAND.md, "Status"), like the glowing
 * dots of the app's board column headers (`GlowingStateDot`, kept subtle in uier #399), scaled for the pin (uier #408).
 */
const pinStatusColors: Record<Exclude<FeedbackStage, 'open'>, { dot: string; glow: string }> = {
    'in-progress': { dot: 'bg-[hsl(var(--pin-status-in-progress))]', glow: 'bg-[hsl(var(--pin-status-in-progress)/0.35)]' },
    ready: { dot: 'bg-[hsl(var(--pin-status-ready))]', glow: 'bg-[hsl(var(--pin-status-ready)/0.35)]' },
    done: { dot: 'bg-[hsl(var(--pin-status-done))]', glow: 'bg-[hsl(var(--pin-status-done)/0.35)]' }
};

/**
 * A thread's status on its pin (uier #364): a solid 8 px dot in the status's colour with a white ring like the pin's
 * and a soft halo of its colour, on the pin's round top-right edge, the corner the sharp tip leaves free, above the
 * message count on the bottom-right (uier #397, #408). The ring is ink-scope white like the pin's, but the dot takes
 * the threads' theme (light or dark status tokens, `--pin-status-*` in styles/toolbar-theme.css), so it is the same
 * colour as the app's status dots (uier #426); the white ring keeps it readable on any page. The halo takes no room. Open says nothing; the pin's name says the
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
