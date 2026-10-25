import type { DbComment, DbCommentKind, DbCommentPosition, DbDeviceSize, DbThreadItem } from '../db/schema';
import { displayName } from './visitor';
import { normalizePath } from './validation';
import { MAX_LIST_RESPONSE_BYTES } from './limits';

export type CommentAuthorDto = {
    name: string;
    isMe: boolean;
};

export type CommentThreadItemDto = {
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
    id: string;
    path: string;
    position: DbCommentPosition;
    /** Public id, numbered per domain (`#12`); missing on old comments */
    number?: number;
    /** A screenshot of the commented part of the page (`GET .../comments/<id>/screenshot`), in pixels */
    screenshot?: { width: number; height: number };
    kind: DbCommentKind;
    thread: { items: CommentThreadItemDto[] };
    /** The coarse size and the viewport (width, height in CSS pixels) the comment was left from */
    device?: { size?: DbDeviceSize; windowSize?: [number, number] };
    resolved: boolean;
    isMine: boolean;
    createdAt?: string;
};

/** `GET /api/visitor` */
export type VisitorDto = {
    /** The visitor's guest name (`Guest XXXX`), `null` before their first comment or reply */
    name: string | null;
};

const deviceSizes: readonly DbDeviceSize[] = ['desktop', 'tablet', 'mobile'];
const commentKinds: readonly DbCommentKind[] = ['comment', 'feedback', 'bug', 'rewrite'];

function optionalString(value: unknown) {
    return typeof value === 'string' ? value : undefined;
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
            yNormal: typeof value.yNormal === 'number' ? value.yNormal : 0
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
            endType: value.endType === 'element' ? 'element' : 'text'
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

function toThreadItemDto(item: DbThreadItem, visitorAuthorId: string | undefined): CommentThreadItemDto {
    if (typeof item.deletedAt === 'string')
        return { id: String(item.id), deleted: true, createdAt: optionalString(item.createdAt) };

    return {
        id: String(item.id),
        text: optionalString(item.text) ?? '',
        quotedText: optionalString(item.quotedText),
        author: { ...toAuthorDto(optionalString(item.authorId), visitorAuthorId), ...(item.authorName ? { name: item.authorName } : {}) },
        createdAt: optionalString(item.createdAt),
        editedAt: optionalString(item.editedAt)
    };
}

/**
 * Public representation of a comment. Never contains author ids, IP hashes, TTL or device details
 * other than the coarse size and the viewport size. Returns `null` for (old) documents that can't
 * be represented.
 */
export function toCommentDto(comment: DbComment, visitorAuthorId: string | undefined): CommentDto | null {
    const position = toPositionDto(comment.position);
    if (!position)
        return null;

    const items = Array.isArray(comment.thread?.items) ? comment.thread.items : [];
    const authorId = optionalString(comment.authorId);

    return {
        id: comment.id,
        path: normalizePath(optionalString(comment.path) ?? '/'),
        position,
        number: typeof comment.number === 'number' && Number.isInteger(comment.number) ? comment.number : undefined,
        screenshot: comment.screenshot && Number.isInteger(comment.screenshot.width) && Number.isInteger(comment.screenshot.height)
            ? { width: comment.screenshot.width, height: comment.screenshot.height }
            : undefined,
        kind: commentKinds.find(kind => kind === comment.kind) ?? 'comment',
        thread: {
            items: items
                .filter(item => typeof item === 'object' && item !== null && item.id != null)
                .map(item => toThreadItemDto(item, visitorAuthorId))
        },
        device: toDeviceDto(comment.device),
        resolved: comment.resolved === true,
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
