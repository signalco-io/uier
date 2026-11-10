import type { CommentItem } from '../components/@types/Comments';
import { resolveAnchorElement } from '../hooks/useCommentItemRects';
import { pageAnchorElement } from './pageElements';
import type { PageIssue } from './types';

/**
 * The open thread an issue is already reported in, among this page's comments: one posted from the
 * same check (`CommentItem.check`) on the same element, or about the page for an issue without one;
 * else one posted for several elements of the same check ("Comment on all", a `check.count`), which
 * covers the check's issues on this page. So a finding keeps its comment after a reload and for every
 * other reviewer. A thread marked as done no longer counts: an issue found again after it can be
 * reported again. `anchors` keeps each comment's element for the caller's pass over many issues, so
 * a comment is looked up on the page once. `covers` narrows what a thread for several elements
 * covers, by the element it is pinned to (the first of them): a rule's issues and what it could not
 * decide (`PageIssue.review`) are separate lists of the same check.
 */
export function reportedComment(issue: PageIssue, comments: readonly CommentItem[] | undefined, path: string,
    anchors: Map<CommentItem, Element | null> = new Map(), covers?: (anchor: Element | null) => boolean): CommentItem | undefined {
    const anchorOf = (comment: CommentItem) => {
        let element = anchors.get(comment);
        if (element === undefined) anchors.set(comment, element = resolveAnchorElement(comment.position));
        return element;
    };
    // A report of another page (after a client-side navigation) is not about this page's comments
    if (issue.path !== undefined && issue.path !== path) return undefined;
    const sameCheck = comments?.filter(comment => !comment.pending && !comment.resolved && !comment.thread.items[0]?.deleted
        && comment.check?.type === issue.check.type && comment.check.id === issue.check.id);
    if (!sameCheck?.length) return undefined;
    // About the page: page feedback, or a pin on the main content where every page feedback type is off (`useIssueComment`)
    const content = document.querySelector('main') ?? document.body;
    const anchor = issue.element && pageAnchorElement(issue.element);
    const own = issue.element
        ? anchor && sameCheck.find(comment => comment.position.type === 'point' && anchorOf(comment) === anchor)
        : sameCheck.find(comment => comment.position.type === 'page' || (comment.position.type === 'point' && anchorOf(comment) === content));
    // One comment for several elements covers the others too (an issue about the page has none)
    return own || (issue.element ? sameCheck.find(comment => comment.check?.count && (!covers || covers(anchorOf(comment)))) : undefined);
}
