import { cx } from '@signalco/ui-primitives/cx';
import type { FeedbackStage } from '../verification';

/**
 * Each status's circle on the pin (uier #397, #402): a ring with a gradient of the status's colour (BRAND.md,
 * "Status"), bright at the top-left and fading toward the bottom-right, around a solid dot of that colour, over
 * the pin's ink. The app's board column headers glow in the status's colour; this is the smaller, quieter version.
 */
const pinStatusColors: Record<Exclude<FeedbackStage, 'open'>, { ring: string; dot: string }> = {
    'in-progress': {
        ring: 'bg-[linear-gradient(135deg,hsl(var(--brand-in-progress)),hsl(var(--brand-in-progress)/0.3))]',
        dot: 'bg-[hsl(var(--brand-in-progress))]'
    },
    ready: {
        ring: 'bg-[linear-gradient(135deg,hsl(var(--brand-ready)),hsl(var(--brand-ready)/0.3))]',
        dot: 'bg-[hsl(var(--brand-ready))]'
    },
    done: {
        ring: 'bg-[linear-gradient(135deg,hsl(var(--brand-success)),hsl(var(--brand-success)/0.3))]',
        dot: 'bg-[hsl(var(--brand-success))]'
    }
};

/**
 * A thread's status on its pin (uier #364): a small circle on the pin's round top-right edge, the corner the
 * sharp tip leaves free, above the message count on the bottom-right (uier #397). Ink like the pin, so the dark
 * tokens: the status's gradient ring and solid dot on the ink fill, in the pin's white ring, readable on any page.
 * Open says nothing; the pin's name says the status. Decorative.
 */
export function PinStatus({ stage }: { stage: Exclude<FeedbackStage, 'open'> }) {
    const colors = pinStatusColors[stage];
    return (
        <span
            aria-hidden="true"
            data-uier-pin-status={stage}
            className="dark pointer-events-none absolute -right-0.5 -top-0.5 flex size-2.5 rounded-full bg-background ring-[1.5px] ring-foreground">
            <span className={cx('flex size-full rounded-full p-[1.5px]', colors.ring)}>
                <span className="flex size-full items-center justify-center rounded-full bg-background">
                    <span className={cx('size-1 rounded-full', colors.dot)} />
                </span>
            </span>
        </span>
    );
}
