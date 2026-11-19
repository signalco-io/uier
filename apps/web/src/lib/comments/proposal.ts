import { hasVisibleReplacement, isChangeProposal, type ChangeProposal } from '@uier/toolbar/change-proposal';
import { markdownPlainText, type MarkdownMention } from '@uier/toolbar/markdown';
import type { DbComment, DbCommentPosition } from '../db/schema';
import { apiErrors } from './http';

export function rewriteReplacement(proposal: ChangeProposal, markdown: string, mentions?: readonly MarkdownMention[]) {
    if (!proposal.text) return undefined;
    const proposed = markdownPlainText(markdown, mentions);
    if (!hasVisibleReplacement(proposed)) return undefined;
    const updated = { ...proposal, text: { original: proposal.text.original, proposed } };
    return isChangeProposal(updated) ? updated : undefined;
}

/** Keep the replacement in the same conditional write as the first message. */
export function withEditedRewriteProposal(comment: DbComment, itemId: string) {
    const first = comment.thread.items[0];
    const saved = comment.proposal;
    if (comment.kind !== 'rewrite' || first?.id !== itemId || !isChangeProposal(saved) || !saved.text) return comment;
    const proposal = rewriteReplacement(saved, first.text, first.mentions);
    if (!proposal) throw apiErrors.invalidRequest('A rewrite needs visible replacement text different from the original.');
    return proposal.text.proposed === saved.text.proposed ? comment : { ...comment, proposal };
}

/** Repair the projection of older edits without changing the saved evidence or exposing deleted items. */
export function commentProposal(comment: Pick<DbComment, 'kind' | 'proposal' | 'thread'>): ChangeProposal | undefined {
    const first = comment.thread?.items?.[0];
    const saved = comment.proposal;
    if (!first || typeof first.deletedAt === 'string' || !isChangeProposal(saved)) return undefined;
    if (comment.kind !== 'rewrite' || !saved.text) return saved;
    const styles = { styles: saved.styles };
    return rewriteReplacement(saved, first.text, first.mentions) ?? (isChangeProposal(styles) ? styles : undefined);
}

function withoutProposalLabel(position: DbCommentPosition): DbCommentPosition {
    if (position?.type !== 'point' || position.proposalLabelHash === undefined) return position;
    const { proposalLabelHash: _labelHash, ...point } = position;
    return point;
}

/** Removing the first message removes the proposal and its evidence from every stored anchor. */
export function withoutCommentProposal(comment: DbComment): DbComment {
    const { proposal: _proposal, anchorContext, ...rest } = comment;
    return {
        ...rest,
        position: withoutProposalLabel(comment.position),
        ...(anchorContext ? { anchorContext: { ...anchorContext,
            original: withoutProposalLabel(anchorContext.original), previous: withoutProposalLabel(anchorContext.previous) } } : {})
    };
}
