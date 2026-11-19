import type { SqlParameter } from '@azure/cosmos';
import type { DbComment } from '../db/schema';
import { matchesVisibility, visibilitySql, type VisibilityFilter } from './visibilityFilter';

export type ProofThreadFilter = {
    /** An explicit asset, or the set of live assets in a member's project. */
    asset: string | readonly string[];
    versionId?: string;
    reviewerId?: string;
    visibility?: VisibilityFilter;
    authorId?: string;
    authorShareId?: string;
};

export const websiteThreadsSql = ' AND NOT IS_DEFINED(c.assetTarget)';

export function matchesProofThread(comment: DbComment, filter?: ProofThreadFilter) {
    const target = comment.assetTarget;
    if (!filter) return !target;
    if (!target || (typeof filter.asset === 'string' ? target.assetId !== filter.asset : !filter.asset.includes(target.assetId))) return false;
    if (filter.authorId !== undefined && comment.authorId !== filter.authorId) return false;
    if (filter.authorShareId !== undefined && target.authorShareId !== filter.authorShareId) return false;
    if (!matchesVisibility(comment, filter.visibility)) return false;

    const { reviewerId, versionId } = filter;
    if (reviewerId !== undefined) {
        const request = comment.verification;
        return !comment.resolved && !comment.archivedAt && (filter.authorShareId === undefined || !comment.thread.items[0]?.deletedAt)
            && request?.outcome === 'pending' && request.reviewer === reviewerId
            && request.evidence?.assetId === target.assetId
            && (versionId === undefined || request.evidence.after.versionId === versionId);
    }
    return versionId === undefined || target.source.versionId === versionId
        || comment.verification?.evidence?.after.versionId === versionId
        || Boolean(target.relocations?.some(location => location.versionId === versionId));
}

/** Page and count share the predicate and Cosmos' automatic range indexes for nested scalar paths. */
export function proofThreadSql(filter?: ProofThreadFilter): { clause: string; parameters: SqlParameter[] } {
    if (!filter) return { clause: websiteThreadsSql, parameters: [] };
    const visibility = visibilitySql(filter.visibility);
    const parameters: SqlParameter[] = [...visibility.parameters];
    let clause = visibility.clause;
    if (typeof filter.asset === 'string') {
        parameters.push({ name: '@asset', value: filter.asset });
        clause += ' AND c.assetTarget.assetId = @asset';
    } else {
        const keys = filter.asset.map((value, index) => {
            const name = `@proofAsset${index}`;
            parameters.push({ name, value });
            return name;
        });
        clause += keys.length ? ` AND c.assetTarget.assetId IN (${keys.join(', ')})` : ' AND false';
    }
    if (filter.authorId !== undefined) {
        parameters.push({ name: '@proofAuthor', value: filter.authorId });
        clause += ' AND c.authorId = @proofAuthor';
    }
    if (filter.authorShareId !== undefined) {
        parameters.push({ name: '@proofAuthorShare', value: filter.authorShareId });
        clause += ' AND c.assetTarget.authorShareId = @proofAuthorShare';
        if (filter.reviewerId !== undefined) clause += ' AND NOT IS_STRING(c.thread.items[0].deletedAt)';
    }
    if (filter.versionId !== undefined) parameters.push({ name: '@proofVersion', value: filter.versionId });
    if (filter.reviewerId !== undefined) {
        parameters.push({ name: '@proofReviewer', value: filter.reviewerId });
        clause += ' AND (NOT IS_DEFINED(c.resolved) OR c.resolved = false) AND NOT IS_STRING(c.archivedAt)'
            + " AND c.verification.outcome = 'pending' AND c.verification.reviewer = @proofReviewer"
            + ' AND c.verification.evidence.assetId = c.assetTarget.assetId';
        if (filter.versionId !== undefined) clause += ' AND c.verification.evidence.after.versionId = @proofVersion';
    } else if (filter.versionId !== undefined) {
        clause += ' AND (c.assetTarget.source.versionId = @proofVersion OR c.verification.evidence.after.versionId = @proofVersion'
            + ' OR ARRAY_CONTAINS(c.assetTarget.relocations, {"versionId": @proofVersion}, true))';
    }
    return { clause, parameters };
}
