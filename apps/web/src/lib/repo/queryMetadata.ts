import { commentPriority } from '@uier/toolbar/triage';
import { feedbackStage } from '@uier/toolbar/verification';
import type { DbComment } from '../db/schema';
import { threadActivity } from '../comments/activity';
import { currentAiTitle, manualThreadTitle } from '../titles/model';

/** Internal query fields, refreshed in the same conditional write as the canonical comment. */
export type CommentQueryMetadata = {
    version: 1;
    status: 'open' | 'in-progress' | 'ready' | 'done';
    statusRank: number;
    priority: 'urgent' | 'high' | 'normal' | 'low';
    priorityRank: number;
    created?: string;
    updated?: string;
    completed?: string;
    archived?: string;
    createdMissing: boolean;
    updatedMissing: boolean;
    completedMissing: boolean;
    archivedMissing: boolean;
    numberMissing: boolean;
    assigneeIds: string[];
    authorIds: string[];
    mentionIds: string[];
    agentKinds: string[];
    replyCount: number;
    hasScreenshot: boolean;
    hasFixLink: boolean;
    /** Names and AI titles are added only by the audience-aware service. */
    searchText: string;
    manualTitle?: string;
    aiTitle?: string;
    topActor?: string;
    topSequence: number;
    secondActorSequence: number;
};

function timestamp(...values: (string | undefined)[]) {
    for (const value of values) {
        const time = Date.parse(value ?? '');
        if (Number.isFinite(time)) return new Date(time).toISOString();
    }
    return undefined;
}

const distinct = (values: (string | undefined)[]) => [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))].sort();

type QueryMetadataComment = Pick<DbComment, 'thread' | 'activity' | 'priority' | 'resolved' | 'inProgress' |
    'createdAt' | 'updatedAt' | 'completedAt' | 'archivedAt' | 'manualTitle' | 'aiTitle' | 'authorId' |
    'assigneeId' | 'assigneeIds' | 'path' | 'number'> & {
    screenshot?: unknown;
    hasScreenshot?: boolean;
    verification?: Pick<NonNullable<DbComment['verification']>, 'outcome' | 'fixUrl'>;
    assigneeAgent?: Pick<NonNullable<DbComment['assigneeAgent']>, 'kind' | 'assigneeId'>;
    assigneeAgents?: Pick<NonNullable<DbComment['assigneeAgent']>, 'kind' | 'assigneeId'>[];
};

/** No viewer, project-setting or mutable directory state is baked into the canonical record. */
export function commentQueryMetadata(comment: QueryMetadataComment): CommentQueryMetadata {
    const items = Array.isArray(comment.thread?.items) ? comment.thread.items : [];
    const visible = items.filter(item => !item.deletedAt);
    const status = feedbackStage(comment);
    const priority = commentPriority(comment.priority);
    const created = timestamp(comment.createdAt);
    const updated = timestamp(comment.updatedAt, comment.createdAt);
    const completed = timestamp(comment.completedAt, ...(comment.resolved ? [comment.updatedAt, comment.createdAt] : []));
    const archived = comment.archivedAt ? timestamp(comment.archivedAt, comment.updatedAt, comment.createdAt) : undefined;
    const manualTitle = manualThreadTitle(comment);
    const aiTitle = currentAiTitle(comment);
    const actors = Object.entries(threadActivity(comment).byActor).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return {
        version: 1,
        status, statusRank: ['open', 'in-progress', 'ready', 'done'].indexOf(status),
        priority, priorityRank: ['urgent', 'high', 'normal', 'low'].indexOf(priority),
        created, updated, completed, archived,
        createdMissing: created === undefined, updatedMissing: updated === undefined,
        completedMissing: completed === undefined, archivedMissing: archived === undefined,
        numberMissing: !Number.isSafeInteger(comment.number),
        assigneeIds: distinct(Array.isArray(comment.assigneeIds) ? comment.assigneeIds : [comment.assigneeId]),
        // The existing author= filter includes the opener, even after a deleted first-message placeholder.
        authorIds: distinct([comment.authorId, ...visible.map(item => item.authorId)]),
        mentionIds: distinct(visible.flatMap(item => item.mentions?.map(mention => mention.userId) ?? [])),
        agentKinds: distinct((Array.isArray(comment.assigneeAgents) ? comment.assigneeAgents : comment.assigneeAgent ? [comment.assigneeAgent] : [])
            .filter(agent => (Array.isArray(comment.assigneeIds) ? comment.assigneeIds : [comment.assigneeId]).includes(agent.assigneeId)).map(agent => agent.kind)),
        replyCount: Math.max(0, items.length - 1),
        hasScreenshot: Boolean(comment.hasScreenshot || comment.screenshot || visible.some(item => item.screenshot)),
        hasFixLink: Boolean(comment.verification?.fixUrl),
        searchText: [comment.path, Number.isSafeInteger(comment.number) ? `#${comment.number}` : '', manualTitle ?? '',
            ...visible.flatMap(item => [item.text ?? '', item.quotedText ?? ''])].join('\n').toLowerCase(),
        ...(manualTitle ? { manualTitle } : {}), ...(aiTitle ? { aiTitle } : {}),
        ...(actors[0] ? { topActor: actors[0][0] } : {}),
        topSequence: actors[0]?.[1] ?? 0, secondActorSequence: actors[1]?.[1] ?? 0
    };
}

/** Caller-supplied or old metadata is never trusted on a canonical write. */
export function withCommentQueryMetadata(comment: DbComment): DbComment {
    return { ...comment, queryMetadata: commentQueryMetadata(comment) };
}
