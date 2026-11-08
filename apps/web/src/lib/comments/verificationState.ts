import { randomUUID } from 'node:crypto';
import { feedbackStage, type FeedbackStatusTarget } from '@uier/toolbar/verification';
import type { DbComment } from '../db/schema';

/**
 * Boolean status writes cannot attest a fix. Same-status polls preserve pending readiness and In
 * progress; Done clears In progress.
 */
export function ordinaryVerificationStatus(comment: DbComment, resolved: boolean, explicitReopen = false): DbComment {
    if (Boolean(comment.resolved) === resolved && !(explicitReopen && !resolved && comment.verification?.outcome === 'pending')) return comment;
    const verification = comment.verification;
    const updated: DbComment = { ...comment, resolved, ...(verification ? { verification: { ...verification, revision: randomUUID(),
        outcome: resolved ? 'unconfirmed' as const : 'reopened' as const } } : {}) };
    if (resolved) delete updated.inProgress;
    return updated;
}

/**
 * An ordinary status write to Open, In progress or Done (the app's status menu, the toolbar, MCP).
 * The thread itself when it is already there. Leaving Ready to verify ends the check without
 * confirmation, as Reopen and Done do; only Done resolves, and only In progress keeps the flag.
 */
export function withOrdinaryStage(comment: DbComment, stage: FeedbackStatusTarget): DbComment {
    if (feedbackStage(comment) === stage) return comment;
    const updated: DbComment = { ...ordinaryVerificationStatus(comment, stage === 'done', true) };
    if (stage === 'in-progress') updated.inProgress = true;
    else delete updated.inProgress;
    return updated;
}
