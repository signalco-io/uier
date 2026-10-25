import type { DbComment, DbThreadItem } from '../db/schema';
import { apiErrors } from './http';
import type { EditThreadItemInput } from './validation';

/** Compare the message being edited, not the entire thread: a concurrent reply can safely stay. */
export function withEditedThreadItem(comment: DbComment, itemId: string, input: EditThreadItemInput, allowed: (item: DbThreadItem) => boolean): DbComment {
    const items = Array.isArray(comment.thread?.items) ? comment.thread.items : [];
    const item = items.find(item => item.id === itemId);
    if (!item || item.deletedAt)
        throw apiErrors.notFound('Message not found.');
    if (!allowed(item))
        throw apiErrors.forbidden('Only the author or an admin can edit this message.');
    if (item.text !== input.expectedText)
        throw apiErrors.conflict();
    const now = new Date().toISOString();
    return {
        ...comment,
        updatedAt: now,
        thread: { ...comment.thread, items: items.map(current => current === item ? { ...current, text: input.text, editedAt: now } : current) }
    };
}
