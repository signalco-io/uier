import { nanoid } from 'nanoid';
import type { DbComment, DbCommentDevice, DbThreadItem } from '../db/schema';
import { getCommentsStore, type CommentsStore } from '../repo/commentsStore';
import { toCommentDto, type CommentDto } from './dto';
import { apiErrors, type CommentsApiContext } from './http';
import {
    COMMENT_TTL_SECONDS,
    MAX_LIST_COMMENTS,
    MAX_THREAD_ITEMS,
    PREVIEW_COMMENT_TTL_SECONDS
} from './limits';
import { enforceNewCommentLimits, enforceReplyLimits, type RateLimitSubject } from './rateLimits';
import type { CreateCommentInput, ReplyInput, UpdateCommentInput } from './validation';
import { hashIp, isLoopbackIp, resolveClientIp } from './visitor';

const MAX_UPDATE_ATTEMPTS = 8;

function nowIso() {
    return new Date().toISOString();
}

/** 90 days; preview deployments keep comments as long as their container default (7 days) */
function commentTtlSeconds() {
    return process.env.VERCEL_ENV === 'preview' ? PREVIEW_COMMENT_TTL_SECONDS : COMMENT_TTL_SECONDS;
}

/**
 * IP used for rate limiting. Outside of Vercel (local development and e2e tests) loopback
 * requests are not IP limited, so all local test visitors don't share a single bucket.
 */
function rateLimitIpHash(request: Request, domain: string) {
    const onVercel = Boolean(process.env.VERCEL);
    const ip = resolveClientIp(request);
    if (!ip)
        return onVercel ? hashIp('unknown', domain) : undefined;
    if (!onVercel && isLoopbackIp(ip))
        return undefined;
    return hashIp(ip, domain);
}

function rateLimitSubject({ request, domain, visitor }: CommentsApiContext): RateLimitSubject {
    return {
        domain,
        authorId: visitor.authorId,
        ipHash: rateLimitIpHash(request, domain)
    };
}

function compactDevice(device: CreateCommentInput['device']): DbCommentDevice | undefined {
    if (!device)
        return undefined;

    const compacted = Object.fromEntries(Object.entries(device).filter(([, value]) => value !== undefined)) as DbCommentDevice;
    return Object.keys(compacted).length ? compacted : undefined;
}

function toDto(comment: DbComment, context: CommentsApiContext): CommentDto {
    const dto = toCommentDto(comment, context.visitor.authorId);
    if (!dto)
        throw new Error(`Comment ${comment.id} can't be represented`);
    return dto;
}

function assertCommentAuthor(comment: DbComment, context: CommentsApiContext) {
    if (!comment.authorId || comment.authorId !== context.visitor.authorId)
        throw apiErrors.forbidden('Only the author of the comment can do this.');
}

/**
 * Read-modify-write with optimistic concurrency (Cosmos etag / If-Match), retried on conflicts, so
 * concurrent replies or deletes never overwrite each other.
 */
async function updateComment(
    store: CommentsStore,
    domain: string,
    id: string,
    update: (comment: DbComment) => DbComment
) {
    for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt++) {
        const stored = await store.get(domain, id);
        if (!stored)
            throw apiErrors.notFound();

        const updated = update(stored.comment);
        const result = await store.replace(updated, stored.etag);
        if (result === 'ok')
            return updated;
        if (result === 'not_found')
            throw apiErrors.notFound();

        // Somebody else modified the comment in the meantime - back off a bit and retry on the new version
        await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1) + Math.random() * 25));
    }

    throw new Error(`Comment ${id} update failed after ${MAX_UPDATE_ATTEMPTS} concurrent modification attempts`);
}

export async function listComments(context: CommentsApiContext, path: string) {
    const comments = await getCommentsStore().list(context.domain, path, MAX_LIST_COMMENTS);
    return comments
        .map(comment => toCommentDto(comment, context.visitor.authorId))
        .filter(comment => comment !== null);
}

export async function createComment(context: CommentsApiContext, input: CreateCommentInput) {
    const store = getCommentsStore();
    const subject = rateLimitSubject(context);
    await enforceNewCommentLimits(store, subject, input.path);

    const now = nowIso();
    const firstItem: DbThreadItem = {
        id: `item_${nanoid()}`,
        text: input.text,
        quotedText: input.quotedText,
        authorId: subject.authorId,
        ipHash: subject.ipHash,
        createdAt: now
    };
    const comment: DbComment = {
        id: `comment_${nanoid()}`,
        domain: context.domain,
        path: input.path,
        position: input.position,
        thread: { items: [firstItem] },
        device: compactDevice(input.device),
        resolved: false,
        authorId: subject.authorId,
        ipHash: subject.ipHash,
        createdAt: now,
        updatedAt: now,
        ttl: commentTtlSeconds()
    };

    await store.create(comment);
    return toDto(comment, context);
}

export async function replyToComment(context: CommentsApiContext, id: string, input: ReplyInput) {
    const store = getCommentsStore();
    const subject = rateLimitSubject(context);
    if (!await store.get(context.domain, id))
        throw apiErrors.notFound();

    await enforceReplyLimits(store, subject);

    const updated = await updateComment(store, context.domain, id, comment => {
        const items = Array.isArray(comment.thread?.items) ? comment.thread.items : [];
        if (items.length >= MAX_THREAD_ITEMS)
            throw apiErrors.invalidRequest(`This thread is full (maximum ${MAX_THREAD_ITEMS} messages).`);

        const now = nowIso();
        return {
            ...comment,
            thread: {
                ...comment.thread,
                items: [...items, {
                    id: `item_${nanoid()}`,
                    text: input.text,
                    authorId: subject.authorId,
                    ipHash: subject.ipHash,
                    createdAt: now
                }]
            },
            updatedAt: now
        };
    });

    return toDto(updated, context);
}

export async function updateCommentResolved(context: CommentsApiContext, id: string, input: UpdateCommentInput) {
    const updated = await updateComment(getCommentsStore(), context.domain, id, comment => {
        assertCommentAuthor(comment, context);
        return { ...comment, resolved: input.resolved, updatedAt: nowIso() };
    });

    return toDto(updated, context);
}

export async function deleteComment(context: CommentsApiContext, id: string) {
    const store = getCommentsStore();
    const stored = await store.get(context.domain, id);
    if (!stored)
        throw apiErrors.notFound();

    assertCommentAuthor(stored.comment, context);
    if (!await store.delete(context.domain, id))
        throw apiErrors.notFound();
}

/**
 * Deletes a thread item. Deleting the first item deletes the whole comment (returns `null`),
 * otherwise returns the updated comment.
 */
export async function deleteThreadItem(context: CommentsApiContext, id: string, itemId: string): Promise<CommentDto | null> {
    const store = getCommentsStore();
    const stored = await store.get(context.domain, id);
    if (!stored)
        throw apiErrors.notFound();

    const items = Array.isArray(stored.comment.thread?.items) ? stored.comment.thread.items : [];
    const itemIndex = items.findIndex(item => item.id === itemId);
    if (itemIndex < 0)
        throw apiErrors.notFound('Reply not found.');

    if (itemIndex === 0) {
        await deleteComment(context, id);
        return null;
    }

    const updated = await updateComment(store, context.domain, id, comment => {
        const currentItems = Array.isArray(comment.thread?.items) ? comment.thread.items : [];
        const item = currentItems.find(i => i.id === itemId);
        if (!item)
            throw apiErrors.notFound('Reply not found.');
        if (!item.authorId || item.authorId !== context.visitor.authorId)
            throw apiErrors.forbidden('Only the author of the reply can delete it.');

        return {
            ...comment,
            thread: { ...comment.thread, items: currentItems.filter(i => i !== item) },
            updatedAt: nowIso()
        };
    });

    return toDto(updated, context);
}
