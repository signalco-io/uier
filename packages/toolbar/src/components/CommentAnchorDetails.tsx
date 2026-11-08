import { useProjectViewer } from '../project/ProjectGate';
import { createContext, useContext } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { Info } from '@signalco/ui-icons';
import { useCommentPlacement, type AnchorState } from '../hooks/useCommentItemRects';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { isCommentArea, type CommentItem, type CommentItemPosition } from './@types/Comments';

export const ReattachContext = createContext<(comment: CommentItem) => void>(() => {});

export const anchorStateText: Record<AnchorState, string> = {
    exact: 'Anchor matches the saved position.', restored: 'Text found at a new position.',
    hidden: 'Target is hidden in this layout. It may appear on another screen size or when opened.',
    missing: 'Target is missing from this page.',
    ambiguous: 'Several targets match. Choose the intended target to reattach.', page: '',
    closed: 'Target is in a menu or dialog that is closed. Open it to see the comment in place.'
};

/** The closed state with the opener's name: "Open “Account” to see the comment in place." */
function closedText(position: CommentItemPosition) {
    const name = position.type !== 'page' ? position.layer?.label : undefined;
    return name ? `Target is in a menu or dialog that is closed. Open “${name}” to see the comment in place.` : anchorStateText.closed;
}

/** ", after opening “Account”": the anchor is in a menu, popover or dialog that a page element opens */
function openedFrom(position: CommentItemPosition) {
    if (position.type === 'page' || !position.layer) return '';
    return position.layer.label ? `, after opening “${position.layer.label}”` : ', in a menu or dialog';
}

export function describeAnchor(position: CommentItemPosition) {
    return (position.type === 'text' ? `Text: ${position.text}`
        : isCommentArea(position) ? `Area of element: ${position.selector}`
            : position.type === 'point' ? `Element: ${position.selector}` : 'Whole page') + openedFrom(position);
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

/**
 * Where the thread's pin is on this page, when that needs attention (moved text, a hidden, missing
 * or ambiguous target), with "Reattach comment"; how often the anchor changed. A matching anchor
 * renders nothing visible: reattaching it is in the first message's menu.
 */
export function CommentAnchorDetails({ comment }: { comment: CommentItem }) {
    const reattach = useReattach(comment);
    const { state } = useCommentPlacement(reattach.samePage ? comment.position : undefined);
    if (comment.position.type === 'page') return null;
    // Only states that need attention are shown, and a closed menu's (where to find the anchor); a
    // matching anchor stays quiet
    const notice = state !== 'exact' && state !== 'page';
    const text = state === 'closed' ? closedText(comment.position) : anchorStateText[state];
    const offSource = reattach.canEdit && reattach.samePage && !reattach.originalSource;
    if (!reattach.samePage && !comment.anchorContext) return null;

    return (
        <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            {reattach.samePage && (notice ? (
                <div data-uier-anchor-state={state} className="flex items-start gap-2 rounded-lg border px-2.5 py-2">
                    <Info size={14} aria-hidden="true" className="mt-px shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                        <p className="m-0">{text}</p>
                        {/* Nothing to repair while it is only closed: reattaching is in the first message's menu */}
                        {reattach.available && state !== 'closed' && (
                            <Button size="xs" variant="plain" className="-ml-2" onClick={reattach.request}>
                                Reattach comment
                            </Button>
                        )}
                    </div>
                </div>
            ) : (
                // For tests and support: the state of a quiet anchor is still on the page
                <span data-uier-anchor-state={state} className="sr-only">{text}</span>
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
