import type { CommentItem } from '../components/@types/Comments';
import { resolveAnchorElement } from '../hooks/useCommentItemRects';
import { pageAnchorElement } from './pageElements';
import type { PageIssue } from './types';

/**
 * The open thread an issue is already reported in, among this page's comments: one posted from the
 * same check (`CommentItem.check`) on the same element, or about the page for an issue without one.
 * So a finding keeps its comment after a reload and for every other reviewer. A thread marked as
 * done no longer counts: an issue found again after it can be reported again. `anchors` keeps each
 * comment's element for the caller's pass over many issues, so a comment is looked up on the page once.
 */
export function reportedComment(issue: PageIssue, comments: readonly CommentItem[] | undefined, path: string,
    anchors: Map<CommentItem, Element | null> = new Map()): CommentItem | undefined {
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
    if (issue.element) {
        const anchor = pageAnchorElement(issue.element);
        return anchor && sameCheck.find(comment => comment.position.type === 'point' && anchorOf(comment) === anchor);
    }
    // About the page: page feedback, or a pin on the main content where every page feedback type is off (`useIssueComment`)
    const content = document.querySelector('main') ?? document.body;
    return sameCheck.find(comment => comment.position.type === 'page'
        || (comment.position.type === 'point' && anchorOf(comment) === content));
}
