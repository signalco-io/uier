import { hasVisibleReplacement, isChangeProposal, rewriteOriginalText } from './changeProposal';
import { markdownPlainText, type MarkdownMention } from './markdown';
import type { CommentItem, CommentItemThreadItem } from './components/@types/Comments';

// A saved comment's proposal as the toolbar's thread shows it, without React (`SavedProposal.tsx` renders it)

export function rewriteProposal(original: string | undefined, markdown: string, mentions?: readonly MarkdownMention[]) {
    if (original === undefined || !markdown.trim()) return undefined;
    const proposed = markdownPlainText(markdown, mentions);
    if (!hasVisibleReplacement(proposed)) return undefined;
    const proposal = { text: { original, proposed }, styles: {} };
    return isChangeProposal(proposal) ? proposal : undefined;
}

/** A rewrite saved without a structured proposal: the text it quoted, or the full selection (`rewriteOriginalText`) */
function legacyRewriteOriginal(comment: CommentItem, first: Exclude<CommentItemThreadItem, { deleted: true }>) {
    return rewriteOriginalText(comment.position.type === 'text' ? comment.position.text : undefined, first.quotedText);
}

export function savedProposal(comment: CommentItem | undefined) {
    const first = comment?.thread.items[0];
    if (!comment || !first || first.deleted) return undefined;
    if (isChangeProposal(comment.proposal)) return comment.proposal;
    if (comment.kind !== 'rewrite') return undefined;
    return rewriteProposal(legacyRewriteOriginal(comment, first), first.text, first.mentions);
}

/**
 * A rewrite without a proposal to preview: its suggestion is the original text (nothing to change, so none was saved),
 * or an older one whose proposal can't be rebuilt. Its quoted original and suggestion, for the diff.
 */
export function rewriteWithoutProposal(comment: CommentItem) {
    const first = comment.thread.items[0];
    if (comment.kind !== 'rewrite' || !first || first.deleted || savedProposal(comment) || !first.text.trim()) return undefined;
    const original = legacyRewriteOriginal(comment, first);
    return original === undefined ? undefined : { original, proposed: markdownPlainText(first.text, first.mentions) };
}
