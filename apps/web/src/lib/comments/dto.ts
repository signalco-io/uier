import type { DbComment, DbCommentPosition, DbDeviceSize, DbThreadItem } from '../db/schema';
import { displayName } from './visitor';
import { normalizePath } from './validation';

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
    thread: { items: CommentThreadItemDto[] };
    device?: { size?: DbDeviceSize };
    resolved: boolean;
    isMine: boolean;
    createdAt?: string;
};

const deviceSizes: readonly DbDeviceSize[] = ['desktop', 'tablet', 'mobile'];

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

    return null;
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
        author: toAuthorDto(optionalString(item.authorId), visitorAuthorId),
        createdAt: optionalString(item.createdAt)
    };
}

/**
 * Public representation of a comment. Never contains author ids, IP hashes, TTL or device details
 * other than the coarse size. Returns `null` for (old) documents that can't be represented.
 */
export function toCommentDto(comment: DbComment, visitorAuthorId: string | undefined): CommentDto | null {
    const position = toPositionDto(comment.position);
    if (!position)
        return null;

    const items = Array.isArray(comment.thread?.items) ? comment.thread.items : [];
    const authorId = optionalString(comment.authorId);
    const size = comment.device?.size;

    return {
        id: comment.id,
        path: normalizePath(optionalString(comment.path) ?? '/'),
        position,
        thread: {
            items: items
                .filter(item => typeof item === 'object' && item !== null && item.id != null)
                .map(item => toThreadItemDto(item, visitorAuthorId))
        },
        device: size && deviceSizes.includes(size) ? { size } : undefined,
        resolved: comment.resolved === true,
        isMine: Boolean(authorId) && authorId === visitorAuthorId,
        createdAt: optionalString(comment.createdAt)
    };
}
