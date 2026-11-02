import { sha256Hex } from '../app/tokens';
import type { FeedbackContext } from '@uier/toolbar/feedback-context';
import type { IntegrationDeliveryContext, IntegrationReply, IntegrationResult, IntegrationState } from './model';

export type NativeReply = IntegrationReply & { own: boolean; fingerprint: string };
export type ReplyCopies = { copies?: Record<string, { id: string; hash: string; marker: string }>; scanCursor?: string;
    checkOffset?: number; reconcileCursor?: string };
export type ReplyPayload = { text: string; author: string; url: string; marker: string };
export type ReplyTransport = {
    target: string;
    list(cursor?: string): Promise<{ items: NativeReply[]; next?: string }>;
    get(id: string): Promise<NativeReply | null>;
    create(payload: ReplyPayload, metadata: IntegrationState): Promise<string>;
    update(id: string, payload: ReplyPayload): Promise<void>;
    remove(id: string): Promise<void>;
};

export class ReplySyncError extends Error {
    constructor(code: string) { super('Reply sync could not complete.'); this.name = code; }
}

/** One bounded page plus a rotating check of known originals catches edits/deletions off that page. */
export async function readNativeReplies(context: IntegrationDeliveryContext, saved: ReplyCopies, io: Pick<ReplyTransport, 'target' | 'list' | 'get'>, persist: () => Promise<void>) {
    if (!context.connection.replySync?.enabled || !context.statusOnly) return;
    const page = await io.list(saved.scanCursor);
    if (page.items.length > 50 || (page.next && (page.next === saved.scanCursor || page.next.length > 2000))) throw new ReplySyncError('invalid_reply_page');
    await context.receiveReplies?.(page.items.filter(item => !item.own).map(item => ({ ...item, target: io.target })));
    const originals = (context.importedReplies ?? []).filter(item => item.target === io.target);
    const offset = originals.length ? (saved.checkOffset ?? 0) % originals.length : 0;
    for (let index = 0; index < Math.min(3, originals.length); index++) {
        const original = originals[(offset + index) % originals.length]!;
        if (page.items.some(item => item.id === original.externalId)) continue;
        const current = await io.get(original.externalId);
        if (current && !current.own) await context.receiveReplies?.([{ ...current, target: io.target }]);
        else if (!current) await context.receiveReplies?.([{ id: original.externalId, target: io.target, text: '', authorId: 'deleted', authorName: '', createdAt: original.createdAt, deleted: true }]);
    }
    saved.scanCursor = page.next;
    saved.checkOffset = originals.length ? (offset + 3) % originals.length : 0;
    await persist();
}

/** Reconcile an uncertain create before the provider's normal attempt handling. Never blindly resend. */
export async function reconcileNativeReply(context: IntegrationDeliveryContext, saved: ReplyCopies, io: ReplyTransport,
    persist: (clearAttempt?: boolean) => Promise<void>): Promise<IntegrationResult | undefined> {
    const attempt = context.ledger.attempt;
    if (attempt?.step !== 'create_native_reply') return;
    if (attempt.metadata.target !== io.target || typeof attempt.metadata.itemId !== 'string' || typeof attempt.metadata.marker !== 'string')
        return { status: 'ambiguous', code: 'reply_destination_changed' };
    const page = await io.list(saved.reconcileCursor);
    const matches = page.items.filter(item => item.own && item.fingerprint.includes(String(attempt.metadata.marker)));
    if (matches.length > 1) return { status: 'ambiguous', code: 'duplicate_reply' };
    if (matches.length === 1) {
        saved.copies ??= {};
        saved.copies[attempt.metadata.itemId] = { id: matches[0]!.id, marker: attempt.metadata.marker, hash: '' };
        saved.reconcileCursor = undefined; await persist(true); return;
    }
    saved.reconcileCursor = page.next; await persist();
    return page.next ? { status: 'waiting', code: 'finding_reply' } : { status: 'ambiguous', code: 'reply_create_unconfirmed' };
}

/** Only app-owned copies are changed. Their ids/markers/hashes are the only persisted reply data. */
export async function sendNativeReplies(context: IntegrationDeliveryContext, saved: ReplyCopies, io: ReplyTransport,
    persist: (clearAttempt?: boolean) => Promise<void>) {
    const copies = saved.copies ??= {};
    const remove = async (itemId: string) => {
        const copy = copies[itemId]!; const current = await io.get(copy.id);
        if (current && (!current.own || !current.fingerprint.includes(copy.marker))) throw new ReplySyncError('reply_ownership_changed');
        if (current) await io.remove(copy.id);
        delete copies[itemId]; await persist(true);
    };
    if (context.mode === 'cleanup') {
        for (const itemId of Object.keys(copies)) await remove(itemId);
        return;
    }
    if (!context.connection.replySync?.enabled || !context.feedback || context.statusOnly) return;
    const present = new Set(context.feedback.context.discussion.map(item => item.id));
    // Deleted uier replies are removed from the source array, rather than always tombstoned.
    for (const itemId of Object.keys(copies)) if (!present.has(itemId)) await remove(itemId);
    for (const item of context.feedback.context.discussion) {
        const copy = copies[item.id];
        if (item.deleted) { if (copy) await remove(item.id); continue; }
        if (!copy && (!item.createdAt || Date.parse(item.createdAt) < Date.parse(context.connection.replySync.since))) continue;
        const marker = `uier-reply-${sha256Hex(`${context.connection.id}:${io.target}:${item.id}`)}`;
        const url = new URL(context.feedback.context.links.comment ?? `/app/projects/${context.project.id}`, context.baseUrl);
        url.hash = marker;
        const payload: ReplyPayload = { text: item.text ?? '', author: item.authorName ?? 'Reviewer', url: url.href, marker };
        const hash = sha256Hex(JSON.stringify(payload));
        if (!copy) {
            if (Object.keys(copies).length >= 50) throw new ReplySyncError('reply_copy_limit');
            const id = await io.create(payload, { target: io.target, itemId: item.id, marker });
            copies[item.id] = { id, hash, marker }; await persist(true);
        } else if (copy.hash !== hash) {
            const current = await io.get(copy.id);
            if (!current || !current.own || !current.fingerprint.includes(copy.marker)) throw new ReplySyncError('reply_ownership_changed');
            await io.update(copy.id, payload); copy.hash = hash; await persist(true);
        }
    }
}

/** Older discussion stays in the document; new replies live in its native comments. */
export function replyBodyContext(context: IntegrationDeliveryContext, saved?: ReplyCopies): FeedbackContext {
    const feedback = context.feedback!.context;
    const cutoff = context.connection.replySync?.enabled ? Date.parse(context.connection.replySync.since) : Infinity;
    return { ...feedback, discussion: feedback.discussion.filter(item => !saved?.copies?.[item.id]
        && (!item.createdAt || Date.parse(item.createdAt) < cutoff)) };
}

/** HTML is never rendered in uier. This keeps common provider formatting readable as plain text. */
export function replyPlainText(value: string) {
    return value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]*>/g, '')
        .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => { const n = code[0]!.toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; })
        .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&').trim();
}
