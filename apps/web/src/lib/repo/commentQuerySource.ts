import type { DbAiTitle, DbComment, DbCommentDevice, DbMention, DbThreadItem, DbVerification } from '../db/schema';
import type { SqlParameter } from '@azure/cosmos';
import type { ArchiveFilter } from './archiveFilter';
import type { OriginFilter } from './originFilter';
import type { VisibilityFilter } from './visibilityFilter';
import type { CommentQueryMetadata } from './queryMetadata';

export type CommentQueryMessage = Pick<DbThreadItem, 'id' | 'text' | 'quotedText' | 'authorId' | 'authorName' | 'mentions' | 'deletedAt' | 'createdAt'>;
export type CommentQueryCandidate = Pick<DbComment,
    'id' | 'domain' | 'projectId' | 'path' | 'pageStateVersion' | 'sourcePath' | 'origin' | 'private' | 'authorId' |
    'assigneeId' | 'assigneeIds' | 'priority' | 'resolved' | 'inProgress' | 'archivedAt' | 'number' | 'kind' |
    'feedbackType' | 'check' | 'createdAt' | 'updatedAt' | 'completedAt' | 'activity' | 'manualTitle'> & {
    revision: string;
    hasScreenshot: boolean;
    position: { type: 'point' | 'text' | 'page' };
    verification?: Pick<DbVerification, 'outcome' | 'fixUrl'>;
    device?: DbCommentDevice;
    assigneeAgent?: Pick<NonNullable<DbComment['assigneeAgent']>, 'kind' | 'assigneeId' | 'workingUntil'>;
    assigneeAgents?: Pick<NonNullable<DbComment['assigneeAgent']>, 'kind' | 'assigneeId' | 'workingUntil'>[];
    aiTitle?: DbAiTitle;
    thread: { items: CommentQueryMessage[] };
    queryMetadata?: CommentQueryMetadata;
};

export type CommentCandidatePredicate = {
    /** Code-generated Boolean expression, not a user-provided SQL string. */
    clause: string;
    parameters: SqlParameter[];
    /** Same conservative candidate predicate for the in-memory adapter. */
    test: (candidate: CommentQueryCandidate) => boolean;
};

export type CommentCandidateOptions = {
    visibility?: VisibilityFilter;
    origin?: OriginFilter;
    archive?: ArchiveFilter;
    predicate?: CommentCandidatePredicate;
    maxCandidates?: number;
    maxBytes?: number;
    maxRequestCharge?: number;
    maxDurationMs?: number;
    signal?: AbortSignal;
};

export class CommentQueryBudgetError extends Error {
    readonly code = 'query_too_expensive';
    constructor() { super('This query exceeded its execution budget. Narrow the query and try again.'); this.name = 'CommentQueryBudgetError'; }
}

export function candidateBudget(options: CommentCandidateOptions = {}) {
    const positive = (value: number | undefined, fallback: number, maximum: number) => {
        if (value === undefined) return fallback;
        if (!Number.isFinite(value) || value < 1) throw new Error('Invalid query execution budget.');
        return Math.min(Math.trunc(value), maximum);
    };
    return {
        candidates: positive(options.maxCandidates, 100_000, 100_000),
        bytes: positive(options.maxBytes, 32 * 1024 * 1024, 64 * 1024 * 1024),
        requestCharge: positive(options.maxRequestCharge, 10_000, 20_000),
        durationMs: positive(options.maxDurationMs, 5_000, 15_000)
    };
}

export function throwIfQueryAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('The query was aborted.', 'AbortError');
}

/** Source projection; this internal record never contains screenshot bytes, tokens or audit payloads. */
export function toCommentQueryCandidate(comment: DbComment, revision: string): CommentQueryCandidate {
    const visibleItems = comment.thread?.items ?? [];
    const candidate: CommentQueryCandidate = {
        id: comment.id, domain: comment.domain, path: comment.path, revision,
        position: { type: comment.position?.type ?? 'page' },
        hasScreenshot: Boolean(comment.screenshot || visibleItems.some(item => !item.deletedAt && item.screenshot)),
        thread: { items: visibleItems.map(item => ({
            id: item.id, text: item.deletedAt ? '' : item.text,
            ...(item.deletedAt ? { deletedAt: item.deletedAt } : {
                ...(item.quotedText !== undefined ? { quotedText: item.quotedText } : {}),
                ...(item.authorId !== undefined ? { authorId: item.authorId } : {}),
                ...(item.authorName !== undefined ? { authorName: item.authorName } : {}),
                ...(item.mentions ? { mentions: item.mentions.map(({ userId, start, end }): DbMention => ({ userId, start, end })) } : {})
            }), ...(item.createdAt ? { createdAt: item.createdAt } : {})
        })) }
    };
    const fields = ['projectId', 'pageStateVersion', 'sourcePath', 'origin', 'private', 'authorId', 'assigneeId', 'assigneeIds',
        'priority', 'resolved', 'inProgress', 'archivedAt', 'number', 'kind', 'feedbackType', 'check', 'createdAt', 'updatedAt',
        'completedAt', 'activity', 'manualTitle', 'aiTitle', 'device', 'queryMetadata'] as const;
    for (const field of fields) {
        if (comment[field] !== undefined) Object.assign(candidate, { [field]: structuredClone(comment[field]) });
    }
    if (comment.verification) candidate.verification = { outcome: comment.verification.outcome,
        ...(comment.verification.fixUrl ? { fixUrl: comment.verification.fixUrl } : {}) };
    const agent = (value: NonNullable<DbComment['assigneeAgent']>) => ({ kind: value.kind, assigneeId: value.assigneeId,
        ...(value.workingUntil ? { workingUntil: value.workingUntil } : {}) });
    if (comment.assigneeAgent) candidate.assigneeAgent = agent(comment.assigneeAgent);
    if (comment.assigneeAgents) candidate.assigneeAgents = comment.assigneeAgents.map(agent);
    return candidate;
}

/** A SELECT projection with the same shape as toCommentQueryCandidate, never SELECT *. */
export const commentCandidateProjection = `c.id, c.domain, c.projectId, c.path, c.pageStateVersion, c.sourcePath, c.origin,
 c.private, c.authorId, c.assigneeId, c.assigneeIds, c.priority, c.resolved, c.inProgress, c.archivedAt, c.number, c.kind,
 c.feedbackType, c.check, c.createdAt, c.updatedAt, c.completedAt, c.activity, c.manualTitle, c.aiTitle, c.device, c.queryMetadata,
 c._etag AS revision, {"type": c.position.type} AS position,
 {"outcome": c.verification.outcome, "fixUrl": c.verification.fixUrl} AS verification,
 IIF((IS_OBJECT(c.screenshot) OR (IS_STRING(c.screenshot) AND c.screenshot != "")), true,
 EXISTS(SELECT VALUE s FROM s IN c.thread.items WHERE NOT (IS_STRING(s.deletedAt) AND s.deletedAt != "")
 AND (IS_OBJECT(s.screenshot) OR (IS_STRING(s.screenshot) AND s.screenshot != "")))) AS hasScreenshot,
 {"kind": c.assigneeAgent.kind, "assigneeId": c.assigneeAgent.assigneeId, "workingUntil": c.assigneeAgent.workingUntil} AS assigneeAgent,
 IIF(IS_ARRAY(c.assigneeAgents), ARRAY(SELECT VALUE {"kind": a.kind, "assigneeId": a.assigneeId, "workingUntil": a.workingUntil} FROM a IN c.assigneeAgents), null) AS assigneeAgents,
 {"items": ARRAY(SELECT VALUE IIF(IS_STRING(i.deletedAt) AND i.deletedAt != "",
 {"id": i.id, "text": "", "deletedAt": i.deletedAt, "createdAt": i.createdAt},
 {"id": i.id, "text": i.text, "quotedText": i.quotedText, "authorId": i.authorId,
 "authorName": i.authorName, "mentions": i.mentions, "createdAt": i.createdAt}) FROM i IN c.thread.items)} AS thread`;

/** Cosmos omits undefined object properties, but can retain the surrounding empty projection. */
export function normalizeCandidate(candidate: CommentQueryCandidate): CommentQueryCandidate {
    if (!candidate.verification?.outcome) delete candidate.verification;
    if (!candidate.assigneeAgent?.kind || !candidate.assigneeAgent.assigneeId) delete candidate.assigneeAgent;
    // An explicitly empty array clears legacy singular assignment. Missing arrays retain fallback.
    if (!Array.isArray(candidate.assigneeAgents)) delete candidate.assigneeAgents;
    return candidate;
}

/** Compiler parameters cannot replace the source's mandatory scope/visibility parameters. */
export function validateCandidatePredicate(predicate?: CommentCandidatePredicate) {
    if (!predicate) return;
    if (!predicate.clause || typeof predicate.test !== 'function'
        || predicate.parameters.some(parameter => !/^@q[A-Za-z0-9_]+$/.test(parameter.name)))
        throw new Error('Invalid server query predicate.');
    if (new Set(predicate.parameters.map(parameter => parameter.name)).size !== predicate.parameters.length)
        throw new Error('Duplicate query predicate parameter.');
}
