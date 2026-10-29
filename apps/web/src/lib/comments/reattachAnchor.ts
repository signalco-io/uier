import { nanoid } from 'nanoid';
import type { DbComment } from '../db/schema';
import type { CommentsStore } from '../repo/commentsStore';
import { commentPath } from './dto';
import { ApiError, apiErrors } from './http';
import type { ReattachAnchorInput } from './validation';

/** ETag retries preserve concurrent messages/status; a changed anchor always needs fresh consent. */
export async function reattachAnchor(store: CommentsStore, domain: string, id: string,
    input: ReattachAnchorInput, authorize: (comment: DbComment) => void | Promise<void>,
    finalize: (previous: DbComment, updated: DbComment) => DbComment = (_, updated) => updated) {
    for (let attempt = 0; attempt < 8; attempt++) {
        const stored = await store.get(domain, id);
        if (!stored) throw apiErrors.notFound();
        const comment = stored.comment;
        await authorize(comment);
        if (!comment.thread.items[0] || comment.thread.items[0].deletedAt) throw apiErrors.notFound();
        if (comment.position.type === 'page') throw apiErrors.invalidRequest('Page feedback has no anchor.');
        if (commentPath(comment) !== input.path) throw apiErrors.invalidRequest('Choose a target on the same reviewed page.');
        if ((comment.anchorContext?.revision ?? null) !== input.expectedRevision)
            throw new ApiError(409, 'conflict', 'The anchor changed. Choose it again before saving.');
        const now = new Date().toISOString();
        const updated = finalize(comment, { ...comment, position: input.position, updatedAt: now,
            anchorContext: { original: comment.anchorContext?.original ?? comment.position,
                previous: comment.position, revision: nanoid(), changedAt: now, changes: (comment.anchorContext?.changes ?? 0) + 1 } });
        const result = await store.replace(updated, stored.etag);
        if (result === 'ok') return updated;
        if (result === 'not_found') throw apiErrors.notFound();
    }
    throw apiErrors.conflict();
}
