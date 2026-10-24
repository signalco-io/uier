'use client';

import { HTMLAttributes } from 'react';
import { cx } from '@signalco/ui-primitives/cx';
import { useCommentItemRects } from '../hooks/useCommentItemRects';
import { CommentSelection } from './@types/Comments';

type CommentSelectionHighlightProps = Omit<HTMLAttributes<HTMLDivElement>, 'onClick'> & {
    commentSelection: CommentSelection;
    /** The comment the text belongs to (saved comments; `data-uier-highlight`) */
    commentId?: string;
    /** Makes the tint clickable (opens the thread); the pin stays the keyboard's way in */
    onClick?: () => void;
};

/** The tint over commented text (`--brand-selection`); nothing when the text is not on the page */
export function CommentSelectionHighlight({
    commentSelection, commentId, onClick, className, style
}: CommentSelectionHighlightProps) {
    const selectionRects = useCommentItemRects(commentSelection);
    return (
        <>
            {selectionRects?.map((rect, i) => (
                <div
                    key={i}
                    aria-hidden="true"
                    data-uier-highlight={commentId}
                    onClick={onClick}
                    className={cx(
                        'fixed select-none bg-[hsl(var(--brand-selection))]',
                        onClick ? 'cursor-pointer' : 'pointer-events-none',
                        className
                    )}
                    style={{
                        left: rect.left,
                        top: rect.top + (rect.height < 12 ? 0 : 4),
                        width: rect.width,
                        height: rect.height - (rect.height < 12 ? 0 : 8),
                        willChange: 'left, top',
                        ...style
                    }} />
            ))}
        </>
    );
}
