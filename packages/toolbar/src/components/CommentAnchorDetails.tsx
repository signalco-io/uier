import { useProjectViewer } from '../project/ProjectGate';
import { createContext, useContext } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { Info } from '@signalco/ui-icons';
import { useCommentPlacement } from '../hooks/useCommentItemRects';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { isCommentArea, type CommentItem, type CommentItemPosition } from './@types/Comments';
import { useMessages, useToolbarLanguage, type Messages } from '../i18n';

export const ReattachContext = createContext<(comment: CommentItem) => void>(() => {});


/**
 * The closed state with the opener's name: "Open “Account” to see the comment in place". The name is
 * the outermost opener's: once that is open, a nested toolbar layer's opener has the pin (`depth`).
 */
function closedText(position: CommentItemPosition, t: Messages, depth = 0) {
    const name = position.type !== 'page' && depth === 0 ? position.layer?.label : undefined;
    return name ? t.anchor.closedNamed(name) : t.anchor.state.closed;
}

/** ", after opening “Account”": the anchor is in a menu, popover or dialog that a page element opens */
function openedFrom(position: CommentItemPosition, t: Messages) {
    if (position.type === 'page' || !position.layer) return '';
    return position.layer.label ? t.anchor.afterOpening(position.layer.label) : t.anchor.inLayer;
}

export function describeAnchor(position: CommentItemPosition, t: Messages) {
    return (position.type === 'text' ? t.anchor.text(position.text)
        : isCommentArea(position) ? t.anchor.area(position.selector)
            : position.type === 'point' ? t.anchor.element(position.selector) : t.anchor.wholePage) + openedFrom(position, t);
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
    const t = useMessages();
    const language = useToolbarLanguage();
    const { state, depth } = useCommentPlacement(reattach.samePage ? comment.position : undefined);
    if (comment.position.type === 'page') return null;
    // Only states that need attention are shown, and a closed menu's (where to find the anchor); a
    // matching anchor stays quiet
    const notice = state !== 'exact' && state !== 'page';
    const text = state === 'closed' ? closedText(comment.position, t, depth) : t.anchor.state[state];
    const offSource = reattach.canEdit && reattach.samePage && !reattach.originalSource;
    if (!reattach.samePage && !comment.anchorContext) return null;
    // For tests and support: the state of a quiet anchor is still on the page
    const quiet = reattach.samePage && !notice && <span data-uier-anchor-state={state} className="sr-only">{text}</span>;
    // Nothing visible: the absolutely positioned status alone, so it adds no gap to the thread (uier #215)
    if (quiet && !offSource && !comment.anchorContext) return quiet;

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
                                {t.thread.reattach}
                            </Button>
                        )}
                    </div>
                </div>
            ) : quiet)}
            {offSource && <p className="m-0">{t.anchor.openOriginal}</p>}
            {comment.anchorContext && <details>
                <summary className="flex min-h-6 cursor-pointer items-center hover:text-foreground">{t.anchor.changed(comment.anchorContext.changes)}</summary>
                <div className="mt-1 flex flex-col gap-0.5 border-l-2 pl-2.5">
                    <p className="m-0 break-words">{t.anchor.original(describeAnchor(comment.anchorContext.original, t))}</p>
                    <p className="m-0 break-words">{t.anchor.previous(describeAnchor(comment.anchorContext.previous, t))}</p>
                    <p className="m-0">{t.anchor.changedAt(new Date(comment.anchorContext.changedAt).toLocaleString(language))}</p>
                </div>
            </details>}
        </div>
    );
}
