import { createContext, useContext } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { useCommentPlacement, type AnchorState } from '../hooks/useCommentItemRects';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import type { CommentItem, CommentItemPosition } from './@types/Comments';

export const ReattachContext = createContext<(comment: CommentItem) => void>(() => {});

export const anchorStateText: Record<AnchorState, string> = {
    exact: 'Anchor matches the saved position.', restored: 'Text found at a new position.',
    hidden: 'Target is hidden in this layout. It may appear on another screen size or when opened.',
    missing: 'Target is missing from this page.',
    ambiguous: 'Several targets match. Choose the intended target to reattach.', page: ''
};

export function describeAnchor(position: CommentItemPosition) {
    return position.type === 'text' ? `Text: ${position.text}`
        : position.type === 'point' ? `Element: ${position.selector}` : 'Whole page';
}

export function CommentAnchorDetails({ comment }: { comment: CommentItem }) {
    const { path } = useContext(CommentsBootstrapperContext);
    const request = useContext(ReattachContext);
    const { state } = useCommentPlacement(comment.path === path ? comment.position : undefined);
    if (comment.position.type === 'page') return null;
    const canEdit = (comment.permissions?.edit ?? comment.isMine) && !comment.thread.items[0]?.deleted;
    return <div className="px-4 py-2 text-xs text-muted-foreground">
        {comment.path === path && <p className="m-0" data-uier-anchor-state={state}>{anchorStateText[state]}</p>}
        {comment.anchorContext && <details className="mt-2">
            <summary className="cursor-pointer min-h-11 flex items-center">Anchor changed {comment.anchorContext.changes} {comment.anchorContext.changes === 1 ? 'time' : 'times'}</summary>
            <p className="break-words">Original {describeAnchor(comment.anchorContext.original)}</p>
            <p className="break-words">Previous {describeAnchor(comment.anchorContext.previous)}</p>
            <p>Changed {new Date(comment.anchorContext.changedAt).toLocaleString()}</p>
        </details>}
        {canEdit && comment.path === path && <Button size="sm" variant="plain" className="min-h-11 mt-1" onClick={() => request(comment)}>Reattach comment</Button>}
    </div>;
}
