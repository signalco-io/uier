import { nanoid } from 'nanoid';
import { z } from 'zod';
import { Input, BufferSource, MP4, WEBM } from 'mediabunny';
import { apiErrors } from '../comments/http';
import { keyedHash } from '../comments/environment';
import { rateLimitIpBucket } from '../comments/rateLimits';
import { getCommentsStore, type CommentsStore } from '../repo/commentsStore';
import { recordingUploadDocumentId, type DbComment, type DbCommentRecording, type DbRecordingUpload, type RecordingAttachment } from '../db/schema';
import { getRecordingBlobs, MAX_RECORDING_BYTES, recordingNames, type RecordingBlobs } from './blobStore';
import { getAppStore } from '../app/store';
import type { AppDoc } from '../app/model';

export const MAX_RECORDING_SECONDS = 60;
const uploadLifetimeMs = 10 * 60_000;
const attachmentLifetimeMs = 24 * 60 * 60_000;
export const recordingUploadSchema = z.object({
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/).optional(),
    contentType: z.enum(['video/webm', 'video/mp4']), size: z.number().int().min(1).max(MAX_RECORDING_BYTES),
    // Browser hints are accepted for compatibility; only the server's media inspection is saved.
    duration: z.number().finite().optional(), width: z.number().finite().optional(), height: z.number().finite().optional()
});
type UploadInput = z.infer<typeof recordingUploadSchema>;
const notFound = () => apiErrors.notFound('Recording not found.');
const active = (doc: DbRecordingUpload) => !doc.removedAt && Date.parse(doc.expiresAt) > Date.now();
const attachable = (doc: DbRecordingUpload) => !doc.removedAt && Boolean(doc.metadata) && Date.parse(doc.createdAt) + attachmentLifetimeMs > Date.now();

/** Buffer-only sources and two explicit demuxers cannot follow media URLs or playlists. */
export async function inspectRecording(bytes: Buffer): Promise<Omit<DbCommentRecording, 'id'>> {
    if (!bytes.length || bytes.length > MAX_RECORDING_BYTES) throw apiErrors.tooLarge(MAX_RECORDING_BYTES);
    const input = new Input({ source: new BufferSource(bytes), formats: [MP4, WEBM] });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const inspect = async () => {
            const format = await input.getFormat(), tracks = await input.getTracks();
            const video = await input.getPrimaryVideoTrack();
            if (!video || tracks.length > 8) throw new Error('Missing video');
            const duration = await input.computeDuration(undefined, { skipLiveWait: true });
            const width = Math.round(video.displayWidth), height = Math.round(video.displayHeight);
            if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_RECORDING_SECONDS + 0.25
                || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 4096 ** 2)
                throw new Error('Outside recording limits');
            return { contentType: format === MP4 ? 'video/mp4' as const : 'video/webm' as const, size: bytes.length, duration, width, height };
        };
        return await Promise.race([inspect(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => { input.dispose(); reject(new Error('Media inspection timed out')); }, 10_000);
        })]);
    } catch {
        throw apiErrors.invalidRequest('Choose a valid MP4 or WebM video up to 60 seconds and 25 MB.');
    } finally { clearTimeout(timer); input.dispose(); }
}

export async function startRecordingUpload(request: Request, domain: string, authorId: string, input: UploadInput,
    store = getCommentsStore(), blobs = getRecordingBlobs()) {
    const id = input.idempotencyKey ? `recording_${keyedHash('recording-upload', `${domain}:${authorId}:${input.idempotencyKey}`).slice(0, 32)}` : `recording_${nanoid()}`;
    const documentId = recordingUploadDocumentId(id);
    const previous = await store.getRecordingUpload(domain, documentId);
    let doc = previous?.doc;
    if (doc && (doc.authorId !== authorId || doc.contentType !== input.contentType || doc.expectedSize !== input.size)) throw apiErrors.conflict();
    if (!doc) {
        const day = new Date().toISOString().slice(0, 10);
        for (const [partition, key, limit] of [
            [domain, `actor:${keyedHash('recording-quota', authorId)}`, 10], [domain, 'project', 100],
            ['$recording-ip', rateLimitIpBucket(request), 100]
        ] as const) {
            if (!await store.incrementCounter(partition, `$recordings_${key}_${day}`, limit, 86400))
                throw apiErrors.rateLimited('The daily recording upload limit has been reached.', 3600, 'too_fast');
        }
        doc = { id: documentId, recordingId: id, domain, type: 'recording-upload', authorId,
            createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + uploadLifetimeMs).toISOString(), ttl: -1,
            expectedSize: input.size, contentType: input.contentType };
        try { await store.createRecordingUpload(doc); }
        catch (error) {
            const recovered = await store.getRecordingUpload(domain, documentId);
            if (!recovered || recovered.doc.authorId !== authorId || recovered.doc.expectedSize !== input.size || recovered.doc.contentType !== input.contentType) throw error;
            doc = recovered.doc;
        }
    }
    if (doc.removedAt || doc.attached || Date.parse(doc.createdAt) + attachmentLifetimeMs <= Date.now()) throw notFound();
    if (!active(doc)) {
        const current = await store.getRecordingUpload(domain, documentId);
        if (!current || current.doc.removedAt || current.doc.attached) throw notFound();
        const renewed = { ...current.doc, expiresAt: new Date(Date.now() + uploadLifetimeMs).toISOString() };
        if (await store.replaceRecordingUpload(renewed, current.etag) !== 'ok') throw apiErrors.conflict();
        doc = renewed;
    }
    return { id, expiresAt: doc.expiresAt, ...await blobs.uploadUrl(recordingNames(domain, id).pending, input.contentType, request) };
}

export async function completeRecordingUpload(domain: string, authorId: string, id: string, store = getCommentsStore(), blobs = getRecordingBlobs()) {
    const saved = await store.getRecordingUpload(domain, recordingUploadDocumentId(id));
    if (!saved || saved.doc.authorId !== authorId || saved.doc.removedAt || saved.doc.attached) throw notFound();
    if (saved.doc.metadata && attachable(saved.doc)) return saved.doc.metadata;
    if (!active(saved.doc)) throw notFound();
    if (saved.doc.metadata) return saved.doc.metadata;
    const names = recordingNames(domain, id);
    const bytes = await blobs.read(names.pending, Math.min(saved.doc.expectedSize, MAX_RECORDING_BYTES));
    if (bytes.length !== saved.doc.expectedSize) throw apiErrors.invalidRequest('The recording upload is incomplete.');
    const inspected = await inspectRecording(bytes);
    if (inspected.contentType !== saved.doc.contentType) throw apiErrors.invalidRequest('The recording format does not match the file.');
    // The signed upload URL grants access only to /pending. Evidence is copied to a server-only,
    // immutable final name, so a client cannot change pixels after validation or attachment.
    await blobs.put(names.video, bytes, inspected.contentType);
    const metadata = { id, ...inspected };
    if (await store.replaceRecordingUpload({ ...saved.doc, metadata }, saved.etag) !== 'ok') {
        const current = await store.getRecordingUpload(domain, saved.doc.id);
        if (current?.doc.metadata && !current.doc.removedAt && current.doc.authorId === authorId) return current.doc.metadata;
        throw apiErrors.conflict();
    }
    return metadata;
}

/** The returned replacement is included in the comment+receipt partition transaction. */
export async function prepareCommentRecording(domain: string, authorId: string, id: string | undefined, store = getCommentsStore()): Promise<RecordingAttachment | undefined> {
    if (!id) return undefined;
    const saved = await store.getRecordingUpload(domain, recordingUploadDocumentId(id));
    if (!saved || saved.doc.authorId !== authorId || !attachable(saved.doc) || saved.doc.attached) throw notFound();
    return saved;
}
export function attachRecording(recording: RecordingAttachment | undefined, commentId: string, itemId?: string) {
    return recording ? { ...recording, doc: { ...recording.doc, attached: { commentId, ...(itemId ? { itemId } : {}) } } } : undefined;
}
export async function commentRecordingUrl(request: Request, comment: DbComment, itemId?: string, store = getCommentsStore(), blobs = getRecordingBlobs()) {
    const metadata = itemId ? comment.thread.items.find(item => item.id === itemId && !item.deletedAt)?.recording : comment.recording;
    if (!metadata) throw notFound();
    const record = await store.getRecordingUpload(comment.domain, recordingUploadDocumentId(metadata.id));
    if (!record || record.doc.removedAt || record.doc.attached?.commentId !== comment.id || record.doc.attached?.itemId !== itemId) throw notFound();
    return blobs.url(recordingNames(comment.domain, metadata.id).video, request);
}
const recordingIds = (comment: DbComment | null) => comment ? [comment.recording?.id, ...comment.thread.items.filter(item => !item.deletedAt).map(item => item.recording?.id)].filter((id): id is string => Boolean(id)) : [];

/** Deletion becomes unreadable with its parent; blob failures retain the durable cleanup record. */
export async function cleanupRemovedRecordings(previous: DbComment, updated: DbComment | null, store = getCommentsStore(), blobs = getRecordingBlobs()) {
    const keep = new Set(recordingIds(updated));
    for (const id of recordingIds(previous).filter(id => !keep.has(id))) {
        try {
            const saved = await store.getRecordingUpload(previous.domain, recordingUploadDocumentId(id));
            if (!saved || saved.doc.attached?.commentId !== previous.id) continue;
            if (!saved.doc.removedAt && await store.replaceRecordingUpload({ ...saved.doc, removedAt: new Date().toISOString() }, saved.etag) !== 'ok') continue;
            await blobs.delete(recordingNames(previous.domain, id).video);
        } catch { console.error('[recordings] Recording deletion needs retry'); }
    }
}

/** One bounded page per scheduled tick, with durable progress shared by both environment sweeps. */
export async function sweepRecordings(store: CommentsStore, blobs: RecordingBlobs, key: string, now = Date.now()) {
    const app = getAppStore(), pk = 'recording-sweep';
    const state = await app.get<AppDoc & { continuation?: string }>(pk, key);
    const page = await store.listRecordingUploads(state?.doc.continuation);
    let removed = 0, failed = 0;
    for (const candidate of page.items) {
        try {
            let saved = await store.getRecordingUpload(candidate.domain, candidate.id);
            if (!saved || Math.max(Date.parse(saved.doc.expiresAt) + 60 * 60_000,
                !saved.doc.attached && saved.doc.metadata && !saved.doc.removedAt ? Date.parse(saved.doc.createdAt) + attachmentLifetimeMs : 0) > now) continue;
            const attached = saved.doc.attached;
            if (attached && !saved.doc.removedAt) {
                const owner = await store.get(saved.doc.domain, attached.commentId);
                const live = attached.itemId ? owner?.comment.thread.items.find(item => item.id === attached.itemId && !item.deletedAt)?.recording : owner?.comment.recording;
                if (live?.id === saved.doc.recordingId) {
                    // The stage grant has expired. Keep only the immutable accepted bytes.
                    await blobs.delete(recordingNames(saved.doc.domain, saved.doc.recordingId).pending);
                    continue;
                }
            }
            if (!saved.doc.removedAt) {
                if (await store.replaceRecordingUpload({ ...saved.doc, removedAt: new Date(now).toISOString() }, saved.etag) !== 'ok') continue;
                saved = await store.getRecordingUpload(candidate.domain, candidate.id);
                if (!saved) continue;
            }
            const names = recordingNames(saved.doc.domain, saved.doc.recordingId);
            await blobs.delete(names.video);
            await blobs.delete(names.pending);
            if (await store.deleteRecordingUpload(saved.doc.domain, saved.doc.id, saved.etag) === 'ok') removed++;
        } catch { failed++; console.error('[recordings] Recording cleanup needs retry'); }
    }
    if (!failed) {
        const doc = { id: key, pk, type: 'recording-sweep', ...(page.continuation ? { continuation: page.continuation } : {}), ttl: -1 };
        if (state) await app.replace(doc, state.etag); else await app.create(doc);
    }
    return { removed, failed };
}
