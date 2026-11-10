import { commentCheck, feedbackTypeSnapshot, isCommentKind } from '@uier/toolbar/feedback-types';
import { commentPriority, type CommentPriority } from '@uier/toolbar/triage';
import type { DbComment, DbCommentKind, DbCommentLayer, DbCommentPosition, DbDeviceSize, DbThreadItem } from '../db/schema';
import { pagePath, sourcePagePath, storedPagePath, storedSourcePath, type PageStatePolicy } from '@uier/toolbar/page-state';
import { displayName } from './visitor';
import { MAX_LIST_RESPONSE_BYTES } from './limits';

export type CommentAuthorDto = {
    name: string;
    isMe: boolean;
};

export type CommentThreadItemDto = {
    screenshot?: { width: number; height: number };
    id: string;
    text: string;
    quotedText?: string;
    author: CommentAuthorDto;
    createdAt?: string;
    editedAt?: string;
} | CommentDeletedThreadItemDto;

/** The first item after its author deleted it while others had replied: no text and no author */
export type CommentDeletedThreadItemDto = {
    id: string;
    deleted: true;
    createdAt?: string;
};

export type CommentDto = {
    priority: CommentPriority;
    activity?: import('./activity').ReadActivity;
    id: string;
    /** The page key: comments on `/plans` and `/plans/` share it */
    path: string;
    /** Where links to the comment go when that is not `path` itself (`/plans/`) */
    sourcePath?: string;
    position: DbCommentPosition;
    anchorContext?: DbComment['anchorContext'];
    /** Public id, numbered per domain (`#12`); missing on old comments */
    number?: number;
    /** A screenshot of the commented part of the page (`GET .../comments/<id>/screenshot`), in pixels */
    screenshot?: { width: number; height: number; revision?: string };
    kind: DbCommentKind;
    feedbackType?: import('@uier/toolbar/feedback-types').FeedbackTypeSnapshot;
    /** The page check it was posted from (`count`: how many of its elements one comment covers); missing on every other comment */
    check?: import('@uier/toolbar/feedback-types').CommentCheck;
    thread: { items: CommentThreadItemDto[] };
    /** The coarse size and the viewport (width, height in CSS pixels) the comment was left from */
    device?: { size?: DbDeviceSize; windowSize?: [number, number] };
    verification?: import('@uier/toolbar/verification').VerificationDetails;
    resolved: boolean;
    /** In progress: only when set (missing means not). The stage is `feedbackStage` of `@uier/toolbar/verification`. */
    inProgress?: true;
    isMine: boolean;
    createdAt?: string;
};

/** `GET /api/visitor` */
export type VisitorDto = {
    privateAppFeedback?: boolean;
    draftScope?: string;
    member?: boolean;
    /** Current account name, or the guest name (`Guest XXXX`); `null` before a guest's first write */
    name: string | null;
};

const deviceSizes: readonly DbDeviceSize[] = ['desktop', 'tablet', 'mobile'];

function optionalString(value: unknown) {
    return typeof value === 'string' ? value : undefined;
}

/** The stored view contract remains stable; old comments retain pathname-only links. */
export function commentPath(comment: Pick<DbComment, 'path' | 'pageStateVersion'>) {
    return storedPagePath(optionalString(comment.path) ?? '/', comment.pageStateVersion);
}

/** The page links open: the recorded source path of the same page, else {@link commentPath}. */
export function commentSourcePath(comment: Pick<DbComment, 'path' | 'pageStateVersion' | 'sourcePath'>) {
    return storedSourcePath(commentPath(comment), comment.sourcePath);
}

/**
 * The source path to store with a new comment on page key `path`: the toolbar's `sourcePath`
 * filtered with the same policy, only when it is the same page and not `path` itself.
 */
export function newSourcePath(path: string, sourcePath: string | undefined, policy?: Partial<PageStatePolicy> | null) {
    if (sourcePath === undefined) return undefined;
    const source = sourcePagePath(sourcePath, policy);
    return source !== path && pagePath(source, policy) === path ? source : undefined;
}

/** The opener of the anchor's menu, popover or dialog, when it is a selector and an optional name */
function toLayerDto(layer: unknown): { layer: DbCommentLayer } | Record<string, never> {
    if (typeof layer !== 'object' || layer === null) return {};
    const value = layer as Record<string, unknown>;
    const opener = optionalString(value.opener);
    if (!opener) return {};
    const label = optionalString(value.label);
    const nested = Array.isArray(value.nested) && value.nested.length && value.nested.every(selector => typeof selector === 'string')
        ? value.nested as string[] : undefined;
    return { layer: { opener, ...(label ? { label } : {}), ...(nested ? { nested } : {}) } };
}

/** Copies only the known position fields (old documents may contain anything) */
function toPositionDto(position: unknown): DbCommentPosition | null {
    if (typeof position !== 'object' || position === null)
        return null;

    const value = position as Record<string, unknown>;
    if (value.type === 'point') {
        return {
            type: 'point',
            selector: optionalString(value.selector) ?? '',
            xNormal: typeof value.xNormal === 'number' ? value.xNormal : 0,
            yNormal: typeof value.yNormal === 'number' ? value.yNormal : 0,
            // An area has both sizes; a partial one is a plain point
            ...(typeof value.widthNormal === 'number' && typeof value.heightNormal === 'number'
                ? { widthNormal: value.widthNormal, heightNormal: value.heightNormal }
                : {}),
            ...toLayerDto(value.layer)
        };
    }

    if (value.type === 'text') {
        return {
            type: 'text',
            text: optionalString(value.text) ?? '',
            startSelector: optionalString(value.startSelector) ?? '',
            startOffset: typeof value.startOffset === 'number' ? value.startOffset : 0,
            startType: value.startType === 'element' ? 'element' : 'text',
            endSelector: optionalString(value.endSelector),
            endOffset: typeof value.endOffset === 'number' ? value.endOffset : 0,
            endType: value.endType === 'element' ? 'element' : 'text',
            ...toLayerDto(value.layer)
        };
    }

    if (value.type === 'page') {
        return { type: 'page' };
    }

    return null;
}

function toWindowSize(value: unknown): [number, number] | undefined {
    return Array.isArray(value) && value.length === 2 && value.every(n => typeof n === 'number' && Number.isFinite(n))
        ? [value[0] as number, value[1] as number]
        : undefined;
}

function toDeviceDto(device: DbComment['device']): CommentDto['device'] {
    const size = device?.size && deviceSizes.includes(device.size) ? device.size : undefined;
    const windowSize = toWindowSize(device?.windowSize);
    return size || windowSize ? { size, windowSize } : undefined;
}

function toAuthorDto(authorId: string | undefined, visitorAuthorId: string | undefined): CommentAuthorDto {
    return {
        name: displayName(authorId),
        isMe: Boolean(authorId) && authorId === visitorAuthorId
    };
}

function toThreadItemDto(item: DbThreadItem, visitorAuthorId: string | undefined, names: Map<string, string>): CommentThreadItemDto {
    if (typeof item.deletedAt === 'string')
        return { id: String(item.id), deleted: true, createdAt: optionalString(item.createdAt) };

    const authorId = optionalString(item.authorId);
    return {
        id: String(item.id),
        text: optionalString(item.text) ?? '',
        quotedText: optionalString(item.quotedText),
        author: { ...toAuthorDto(authorId, visitorAuthorId), ...(authorId?.startsWith('user:')
            ? { name: names.get(authorId.slice('user:'.length)) ?? 'Former member' }
            : item.authorName ? { name: item.authorName } : {}) },
        createdAt: optionalString(item.createdAt),
        editedAt: optionalString(item.editedAt),
        ...(item.screenshot ? { screenshot: { width: item.screenshot.width, height: item.screenshot.height } } : {})
    };
}

/**
 * Public representation of a comment. Never contains author ids, IP hashes, TTL or device details
 * other than the coarse size and the viewport size. Returns `null` for (old) documents that can't
 * be represented.
 */
export function toCommentDto(comment: DbComment, visitorAuthorId: string | undefined, names = new Map<string, string>()): CommentDto | null {
    const position = toPositionDto(comment.position);
    if (!position)
        return null;

    const items = Array.isArray(comment.thread?.items) ? comment.thread.items : [];
    const authorId = optionalString(comment.authorId);
    const path = commentPath(comment);
    const sourcePath = commentSourcePath(comment);

    return {
        id: comment.id,
        path,
        ...(sourcePath !== path ? { sourcePath } : {}),
        position,
        ...(comment.anchorContext ? { anchorContext: {
            original: toPositionDto(comment.anchorContext.original) ?? position,
            previous: toPositionDto(comment.anchorContext.previous) ?? position,
            revision: String(comment.anchorContext.revision), changedAt: String(comment.anchorContext.changedAt),
            changes: Number(comment.anchorContext.changes)
        } } : {}),
        number: typeof comment.number === 'number' && Number.isInteger(comment.number) ? comment.number : undefined,
        screenshot: comment.screenshot && Number.isInteger(comment.screenshot.width) && Number.isInteger(comment.screenshot.height)
            ? { width: comment.screenshot.width, height: comment.screenshot.height, ...(comment.screenshot.revision ? { revision: comment.screenshot.revision } : {}) }
            : undefined,
        kind: isCommentKind(comment.kind) ? comment.kind : 'comment',
        ...(feedbackTypeSnapshot(comment.feedbackType, comment.kind) ? { feedbackType: feedbackTypeSnapshot(comment.feedbackType, comment.kind) } : {}),
        ...(commentCheck(comment.check) ? { check: commentCheck(comment.check) } : {}),
        thread: {
            items: items
                .filter(item => typeof item === 'object' && item !== null && item.id != null)
                .map(item => toThreadItemDto(item, visitorAuthorId, names))
        },
        device: toDeviceDto(comment.device),
        resolved: comment.resolved === true,
        ...(comment.inProgress === true && comment.resolved !== true ? { inProgress: true as const } : {}),
        priority: commentPriority(comment.priority),
        isMine: Boolean(authorId) && authorId === visitorAuthorId,
        createdAt: optionalString(comment.createdAt)
    };
}

/**
 * The first comments that fit into {@link MAX_LIST_RESPONSE_BYTES} as a JSON array: the lists of
 * the comments API and of a project's review API
 */
export function withinListResponseSize<T>(comments: T[]): T[] {
    const fitting: T[] = [];
    let bytes = 2;
    for (const comment of comments) {
        bytes += Buffer.byteLength(JSON.stringify(comment)) + 1;
        if (bytes > MAX_LIST_RESPONSE_BYTES)
            break;
        fitting.push(comment);
    }
    return fitting;
}
