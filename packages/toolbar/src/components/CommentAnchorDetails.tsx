import { useProjectViewer } from '../project/ProjectGate';
import { createContext, useContext } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { cx } from '@signalco/ui-primitives/cx';
import { Info } from '@signalco/ui-icons';
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

/**
 * Whether the reviewer can reattach the thread here: its author or an admin, on the page (and
 * environment) it was left on, at the original reviewed site. The first message's menu offers it.
 */
export function useReattach(comment: CommentItem) {
    const { path } = useContext(CommentsBootstrapperContext);
    const request = useContext(ReattachContext);
    const { currentEnvironment } = useProjectViewer();
    const samePage = comment.path === path && (!comment.source || comment.source.environment === currentEnvironment);
    const originalSource = !comment.source || (comment.source.available && comment.source.origin === window.location.origin);
    const canEdit = (comment.permissions?.edit ?? comment.isMine) && !comment.thread.items[0]?.deleted;
    const anchored = comment.position.type !== 'page';
    return {
        samePage,
        canEdit,
        originalSource,
        available: anchored && canEdit && samePage && originalSource,
        request: () => request(comment)
    };
}

/** Only states that need attention are shown; a matching anchor stays quiet */
const noticeStates: AnchorState[] = ['restored', 'hidden', 'missing', 'ambiguous'];

/**
 * Where the thread's pin is on this page, when that needs attention (moved text, a hidden, missing
 * or ambiguous target), with "Reattach comment"; how often the anchor changed. A matching anchor
 * renders nothing visible: reattaching it is in the first message's menu.
 */
export function CommentAnchorDetails({ comment }: { comment: CommentItem }) {
    const reattach = useReattach(comment);
    const { state } = useCommentPlacement(reattach.samePage ? comment.position : undefined);
    if (comment.position.type === 'page') return null;
    const notice = reattach.samePage && noticeStates.includes(state);
    const warning = state === 'missing' || state === 'ambiguous';
    const offSource = reattach.canEdit && reattach.samePage && !reattach.originalSource;
    if (!reattach.samePage && !comment.anchorContext) return null;

    return (
        <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            {reattach.samePage && (notice ? (
                <div data-uier-anchor-state={state} className={cx('flex items-start gap-2 rounded-lg border px-2.5 py-2', warning && 'text-foreground')}>
                    <Info size={14} aria-hidden="true" className="mt-px shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                        <p className="m-0">{anchorStateText[state]}</p>
                        {reattach.available && (
                            <Button size="xs" variant="plain" className="-ml-2" onClick={reattach.request}>
                                Reattach comment
                            </Button>
                        )}
                    </div>
                </div>
            ) : (
                // For tests and support: the state of a quiet anchor is still on the page
                <span data-uier-anchor-state={state} className="sr-only">{anchorStateText[state]}</span>
            ))}
            {offSource && <p className="m-0">Open the original reviewed site to reattach.</p>}
            {comment.anchorContext && <details>
                <summary className="flex min-h-6 cursor-pointer items-center hover:text-foreground">Anchor changed {comment.anchorContext.changes} {comment.anchorContext.changes === 1 ? 'time' : 'times'}</summary>
                <div className="mt-1 flex flex-col gap-0.5 border-l-2 pl-2.5">
                    <p className="m-0 break-words">Original {describeAnchor(comment.anchorContext.original)}</p>
                    <p className="m-0 break-words">Previous {describeAnchor(comment.anchorContext.previous)}</p>
                    <p className="m-0">Changed {new Date(comment.anchorContext.changedAt).toLocaleString()}</p>
                </div>
            </details>}
        </div>
    );
}
