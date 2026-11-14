import { cx } from '@signalco/ui-primitives/cx';
import type { FeedbackStage } from '../verification';

/**
 * Each status's circle on the pin (uier #397): a border in the status's colour (BRAND.md, "Status") around a
 * soft gradient of the same colour, lighter at the top-left and fading toward the edge, over the pin's ink.
 * The app's board column headers glow in the status's colour; this is the smaller, quieter version of it.
 */
const pinStatusColors: Record<Exclude<FeedbackStage, 'open'>, string> = {
    'in-progress': 'border-[hsl(var(--brand-in-progress))] bg-[radial-gradient(circle_at_35%_35%,hsl(var(--brand-in-progress)/0.85),hsl(var(--brand-in-progress)/0.25))]',
    ready: 'border-[hsl(var(--brand-ready))] bg-[radial-gradient(circle_at_35%_35%,hsl(var(--brand-ready)/0.85),hsl(var(--brand-ready)/0.25))]',
    done: 'border-[hsl(var(--brand-success))] bg-[radial-gradient(circle_at_35%_35%,hsl(var(--brand-success)/0.85),hsl(var(--brand-success)/0.25))]'
};

/**
 * A thread's status on its pin (uier #364): a small circle on the pin's round top-right edge, the corner the
 * sharp tip leaves free, above the message count on the bottom-right (uier #397). Ink like the pin, so the dark
 * tokens: the status's colour on the ink fill, in the pin's white ring, readable on any page. Open says nothing;
 * the pin's name says the status. Decorative.
 */
export function PinStatus({ stage }: { stage: Exclude<FeedbackStage, 'open'> }) {
    return (
        <span
            aria-hidden="true"
            data-uier-pin-status={stage}
            className="dark pointer-events-none absolute -right-0.5 -top-0.5 flex size-2.5 rounded-full bg-background ring-[1.5px] ring-foreground">
            <span className={cx('size-full rounded-full border-[1.5px]', pinStatusColors[stage])} />
        </span>
    );
}
