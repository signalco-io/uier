import { cx } from '@signalco/ui-primitives/cx';
import type { FeedbackStage } from '../verification';
import { stageDotColors } from './CommentThreadHeader';

/**
 * A thread's status on its pin (uier #364): the status dot (BRAND.md, "Status", 6 px in the status's
 * colour) on the pin's round bottom-right edge, the corner the message count and the sharp tip leave
 * free. Ink like the pin, so the dark tokens: the dot sits in an ink border and the pin's white ring,
 * readable on any page. Open says nothing; the pin's name says the status. Decorative.
 */
export function PinStatus({ stage }: { stage: Exclude<FeedbackStage, 'open'> }) {
    return (
        <span
            aria-hidden="true"
            data-uier-pin-status={stage}
            className="dark pointer-events-none absolute -bottom-0.5 -right-0.5 box-content flex size-1.5 rounded-full border-[1.5px] border-background bg-background ring-[1.5px] ring-foreground">
            <span className={cx('size-1.5 rounded-full', stageDotColors[stage])} />
        </span>
    );
}
