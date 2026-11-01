'use client';

import { cx } from '@signalco/ui-primitives/cx';

type CommentAreaHighlightProps = {
    rect: DOMRect;
    /** The comment the area belongs to (saved comments; `data-uier-area`) */
    commentId?: string;
    /** Its thread is open (or the comment is being written): the area is tinted too */
    active: boolean;
};

/**
 * The dashed outline around a commented area, with the selection tint while its thread is open.
 * Clicks go through to the page: the pin opens the thread.
 */
export function CommentAreaHighlight({ rect, commentId, active }: CommentAreaHighlightProps) {
    return (
        <div
            aria-hidden="true"
            data-uier-area={commentId ?? ''}
            className={cx(
                'pointer-events-none fixed select-none rounded-sm outline-dashed outline-[hsl(var(--brand-accent))]',
                active ? 'bg-[hsl(var(--brand-selection))] outline-2' : 'outline-1'
            )}
            style={{
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                willChange: 'left, top'
            }} />
    );
}
