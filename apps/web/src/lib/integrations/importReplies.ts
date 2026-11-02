import { sha256Hex } from '../app/tokens';
import { withThreadActivity } from '../comments/activity';
import { MAX_TEXT_LENGTH, MAX_THREAD_ITEMS } from '../comments/limits';
import { ordinaryVerificationStatus } from '../comments/verificationState';
import type { DbComment } from '../db/schema';
import { withNotificationEvent } from '../notifications/events';
import { integrationLabels, type IntegrationConnection, type IntegrationReply } from './model';
import { ReplySyncError } from './replies';

/** Pure projection; the caller rechecks authority and commits with the source ETag. */
export function withImportedReplies(comment: DbComment, connection: IntegrationConnection, input: {
    resolved?: boolean; replies: IntegrationReply[]; at: string;
}) {
    let changed = comment;
    if (connection.twoWaySync === true && input.resolved !== undefined && Boolean(comment.resolved) !== input.resolved) {
        const actorId = `user:${connection.connectedBy}`;
        changed = withNotificationEvent(ordinaryVerificationStatus(withThreadActivity(changed, actorId), input.resolved),
            actorId, input.resolved ? 'resolved' : 'reopened', input.at);
    }
    if (!connection.replySync?.enabled) return changed;
    for (const reply of input.replies) {
        if (typeof reply.id !== 'string' || !reply.id || reply.id.length > 200 || typeof reply.authorId !== 'string' || !reply.authorId
            || (reply.target !== undefined && (typeof reply.target !== 'string' || !reply.target || reply.target.length > 500))
            || reply.authorId.length > 200 || !Number.isFinite(Date.parse(reply.createdAt))
            || typeof reply.text !== 'string' || (!reply.deleted && !reply.text.trim())) continue;
        const id = `item_${sha256Hex(`${connection.provider}:${connection.id}:${reply.target ?? connection.destinationRevision}:${reply.id}`).slice(0, 32)}`;
        const existing = changed.thread.items.find(item => item.id === id);
        if (existing) {
            if (existing.deletedAt || (!reply.deleted && existing.text === reply.text.trim().slice(0, MAX_TEXT_LENGTH))) continue;
            const updated = reply.deleted ? { id: existing.id, text: '', createdAt: existing.createdAt, deletedAt: input.at, integrationSource: existing.integrationSource }
                : { ...existing, text: reply.text.trim().slice(0, MAX_TEXT_LENGTH), editedAt: input.at };
            changed = { ...withThreadActivity(changed, existing.authorId ?? 'integration'), thread: { ...changed.thread,
                items: changed.thread.items.map(item => item.id === id ? updated : item) } };
            continue;
        }
        if (reply.deleted || Date.parse(reply.createdAt) < Date.parse(connection.replySync.since)) continue;
        if (changed.thread.items.length >= MAX_THREAD_ITEMS) throw new ReplySyncError('integration_thread_full');
        const authorId = `integration:${connection.provider}:${sha256Hex(reply.authorId).slice(0, 32)}`;
        const name = typeof reply.authorName === 'string' ? reply.authorName.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 60) : '';
        const item = { id, text: reply.text.trim().slice(0, MAX_TEXT_LENGTH), authorId,
            authorName: `${name || 'Reviewer'} via ${integrationLabels[connection.provider]}`, createdAt: reply.createdAt,
            integrationSource: { provider: connection.provider, connectionId: connection.id, destinationRevision: connection.destinationRevision, externalId: reply.id, target: reply.target } };
        changed = withNotificationEvent({ ...withThreadActivity(changed, authorId), thread: { ...changed.thread, items: [...changed.thread.items, item] } },
            authorId, 'reply', input.at, undefined, undefined, { itemId: id });
    }
    return changed;
}
