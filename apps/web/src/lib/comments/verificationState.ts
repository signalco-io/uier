import { randomUUID } from 'node:crypto';
import type { DbComment } from '../db/schema';

/** Boolean status writes cannot attest a fix. Same-status polls preserve pending readiness. */
export function ordinaryVerificationStatus(comment: DbComment, resolved: boolean, explicitReopen = false): DbComment {
    if (Boolean(comment.resolved) === resolved && !(explicitReopen && !resolved && comment.verification?.outcome === 'pending')) return comment;
    const verification = comment.verification;
    return { ...comment, resolved, ...(verification ? { verification: { ...verification, revision: randomUUID(),
        outcome: resolved ? 'unconfirmed' as const : 'reopened' as const } } : {}) };
}
