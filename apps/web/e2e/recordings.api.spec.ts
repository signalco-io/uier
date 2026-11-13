import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { inspectRecording, startRecordingUpload, completeRecordingUpload, prepareCommentRecording, attachRecording, commentRecordingUrl, cleanupRemovedRecordings, sweepRecordings } from '../src/lib/recordings/service';
import { getRecordingBlobs, localRecordingFile, recordingNames } from '../src/lib/recordings/blobStore';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { commitNewSubmission, submission } from '../src/lib/comments/submissions';
import { recordingUploadDocumentId, type DbComment } from '../src/lib/db/schema';
import { persistProjectAccess } from './support/projectAccess';
import { ensureProjectPublicId } from '../src/lib/app/projectPublicIds';
import { getAppStore } from '../src/lib/app/store';
import { randomToken, signToken } from '../src/lib/app/tokens';
import type { DbProject } from '../src/lib/app/model';
import { POST as reviewStart } from '../app/api/review/[projectId]/recordings/route';
import { POST as reviewComplete } from '../app/api/review/[projectId]/recordings/[id]/complete/route';
import { GET as reviewRead } from '../app/api/review/[projectId]/comments/[id]/recording/route';

const bytes = readFileSync(new URL('./fixtures/recording.webm', import.meta.url));
const previousLocal = process.env.UIER_LOCAL;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => { if (previousLocal === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = previousLocal; });
const init = () => ({ contentType: 'video/webm' as const, size: bytes.length, duration: 0.001, width: 1, height: 1, idempotencyKey: randomUUID() });
const sourceRequest = () => new Request('http://localhost:4004/api/comments/recordings');
async function serviceUpload(domain = `recordings-${randomUUID()}`, author = 'owner') {
    const input = init(), store = getMemoryCommentsStore(), blobs = getRecordingBlobs();
    const upload = await startRecordingUpload(sourceRequest(), domain, author, input, store, blobs);
    await localRecordingFile(new Request(upload.uploadUrl, { method: 'PUT', body: new Uint8Array(bytes), headers: upload.headers }), upload.id);
    const metadata = await completeRecordingUpload(domain, author, upload.id, store, blobs);
    return { domain, author, input, store, blobs, upload, metadata };
}
async function httpUpload(request: APIRequestContext) {
    const response = await request.post('/api/comments/recordings', { data: init() });
    expect(response.ok(), await response.text()).toBe(true);
    const upload = await response.json();
    expect((await request.put(upload.uploadUrl, { data: bytes, headers: upload.headers })).status()).toBe(201);
    const complete = await request.post(`/api/comments/recordings/${upload.id}/complete`);
    expect(complete.ok(), await complete.text()).toBe(true);
    return { upload, metadata: await complete.json() };
}

test('recording API links private bytes to comments and replies, supports seeking, retries and deletion', async ({ request }) => {
    const { upload, metadata } = await httpUpload(request);
    expect(metadata).toMatchObject({ id: upload.id, width: 160, height: 90, contentType: 'video/webm', size: bytes.length });
    expect(metadata.duration).toBeGreaterThan(0.5);
    const input = { idempotencyKey: randomUUID(), path: `/recordings-${randomUUID()}`, position: { type: 'page' }, kind: 'feedback', text: 'Reproduce this issue', recordingId: upload.id };
    const response = await request.post('/api/comments', { data: input });
    expect(response.status(), await response.text()).toBe(201);
    const comment = await response.json();
    expect(comment.recording).toEqual(metadata);
    const again = await request.post('/api/comments', { data: input });
    expect((await again.json()).id).toBe(comment.id);
    expect((await request.post('/api/comments', { data: { ...input, recordingId: 'recording_other' } })).status()).toBe(409);
    const urlResponse = await request.get(`/api/comments/${comment.id}/recording`);
    expect(urlResponse.headers()['cache-control']).toContain('no-store');
    const playback = await urlResponse.json();
    const read = await request.get(playback.url, { headers: { Range: 'bytes=0-31' } });
    expect(read.status()).toBe(206);
    expect(read.headers()['content-range']).toBe(`bytes 0-31/${bytes.length}`);
    expect(await read.body()).toEqual(bytes.subarray(0, 32));
    const replyUpload = await httpUpload(request);
    const replyInput = { text: 'Another recording', recordingId: replyUpload.upload.id, idempotencyKey: randomUUID() };
    const replyResponse = await request.post(`/api/comments/${comment.id}/replies`, { data: replyInput });
    expect(replyResponse.status(), await replyResponse.text()).toBe(201);
    const reply = (await replyResponse.json()).thread.items.at(-1);
    expect(reply.recording.id).toBe(replyUpload.upload.id);
    const replyUrl = await request.get(`/api/comments/${comment.id}/replies/${reply.id}/recording`);
    expect(replyUrl.status()).toBe(200);
    expect((await request.delete(`/api/comments/${comment.id}/replies/${reply.id}`)).ok()).toBe(true);
    expect((await request.get(`/api/comments/${comment.id}/replies/${reply.id}/recording`)).status()).toBe(404);
    expect((await request.get((await replyUrl.json()).url)).status()).toBe(404);
    expect((await request.delete(`/api/comments/${comment.id}`)).ok()).toBe(true);
    expect((await request.get(playback.url)).status()).toBe(404);
});

test('media inspection reads actual streamed WebM metadata and rejects malformed and overlong bytes', async () => {
    expect(await inspectRecording(bytes)).toMatchObject({ width: 160, height: 90, size: bytes.length, contentType: 'video/webm' });
    const mp4 = readFileSync(new URL('./fixtures/recording.mp4', import.meta.url));
    expect(await inspectRecording(mp4)).toMatchObject({ width: 160, height: 90, size: mp4.length, contentType: 'video/mp4' });
    await expect(inspectRecording(Buffer.from('<html>not a video</html>'))).rejects.toMatchObject({ status: 400 });
    // Chromium writes an unknown-length Segment and Cluster. Move that cluster's base time to
    // 65 seconds; the actual packet end timestamps, not supplied duration hints, must reject it.
    const marker = bytes.indexOf(Buffer.from([0xe7, 0x81, 0x00]));
    expect(marker).toBeGreaterThan(0);
    const long = Buffer.concat([bytes.subarray(0, marker), Buffer.from([0xe7, 0x82, 0xfd, 0xe8]), bytes.subarray(marker + 3)]);
    await expect(inspectRecording(long)).rejects.toMatchObject({ status: 400 });
});

test('upload sessions and complete retries are scoped to actor and partition, immutable after validation', async () => {
    const f = await serviceUpload();
    expect(await startRecordingUpload(sourceRequest(), f.domain, f.author, f.input, f.store, f.blobs)).toMatchObject({ id: f.upload.id });
    expect(await completeRecordingUpload(f.domain, f.author, f.upload.id, f.store, f.blobs)).toEqual(f.metadata);
    await expect(completeRecordingUpload(f.domain, 'other', f.upload.id, f.store, f.blobs)).rejects.toMatchObject({ status: 404 });
    await expect(prepareCommentRecording(`${f.domain}-other`, f.author, f.upload.id, f.store)).rejects.toMatchObject({ status: 404 });
    await expect(prepareCommentRecording(f.domain, 'other', f.upload.id, f.store)).rejects.toMatchObject({ status: 404 });
    await expect(localRecordingFile(new Request(f.upload.uploadUrl, { method: 'PUT', body: 'changed bytes', headers: f.upload.headers }), f.upload.id)).rejects.toMatchObject({ status: 409 });
    expect(await f.blobs.read(recordingNames(f.domain, f.upload.id).video)).toEqual(bytes);
    const mismatch = await startRecordingUpload(sourceRequest(), f.domain, f.author, { ...init(), contentType: 'video/mp4' }, f.store, f.blobs);
    await localRecordingFile(new Request(mismatch.uploadUrl, { method: 'PUT', body: new Uint8Array(bytes), headers: mismatch.headers }), mismatch.id);
    await expect(completeRecordingUpload(f.domain, f.author, mismatch.id, f.store, f.blobs)).rejects.toMatchObject({ status: 400 });
});

test('recording attachment and submission receipt commit atomically and recover lost acknowledgements', async () => {
    const f = await serviceUpload();
    const prepared = await prepareCommentRecording(f.domain, f.author, f.upload.id, f.store);
    const comment: DbComment = { id: `comment_${randomUUID()}`, domain: f.domain, path: '/', position: { type: 'page' }, recording: f.metadata, authorId: f.author,
        thread: { items: [{ id: 'first', text: 'Evidence', authorId: f.author }] } };
    const attempt = submission(f.domain, f.author, randomUUID(), { text: 'Evidence', recordingId: f.upload.id })!;
    const original = f.store.commitSubmission.bind(f.store);
    f.store.commitSubmission = async (...args) => { const result = await original(...args); if (result === 'ok') throw new Error('Acknowledgement lost'); return result; };
    try {
        const saved = await commitNewSubmission(f.store, attempt, comment, undefined, attachRecording(prepared, comment.id));
        expect(saved.recording).toEqual(f.metadata);
        expect((await f.store.getRecordingUpload(f.domain, recordingUploadDocumentId(f.upload.id)))!.doc.attached).toEqual({ commentId: comment.id });
    } finally { f.store.commitSubmission = original; }
    await expect(prepareCommentRecording(f.domain, f.author, f.upload.id, f.store)).rejects.toMatchObject({ status: 404 });
    const authorized = await commentRecordingUrl(sourceRequest(), comment, undefined, f.store, f.blobs);
    expect(new URL(authorized.url).pathname).toContain('/api/recording-files/');
    await cleanupRemovedRecordings(comment, null, f.store, f.blobs);
    await expect(commentRecordingUrl(sourceRequest(), comment, undefined, f.store, f.blobs)).rejects.toMatchObject({ status: 404 });
    await expect(f.blobs.read(recordingNames(f.domain, f.upload.id).video)).rejects.toMatchObject({ status: 404 });
});

test('daily reservations bound uploads and abandoned recordings retain durable cleanup until swept', async () => {
    const domain = `quota-${randomUUID()}`, store = getMemoryCommentsStore();
    for (let index = 0; index < 10; index++) await startRecordingUpload(sourceRequest(), domain, 'owner', init(), store);
    await expect(startRecordingUpload(sourceRequest(), domain, 'owner', init(), store)).rejects.toMatchObject({ status: 429 });
    const f = await serviceUpload();
    const swept = await sweepRecordings(f.store, f.blobs, `fixture-${randomUUID()}`, Date.now() + 25 * 60 * 60_000);
    expect(swept.failed).toBe(0);
    expect(await f.store.getRecordingUpload(f.domain, recordingUploadDocumentId(f.upload.id))).toBeNull();
    await expect(f.blobs.read(recordingNames(f.domain, f.upload.id).pending)).rejects.toMatchObject({ status: 404 });
    await expect(f.blobs.read(recordingNames(f.domain, f.upload.id).video)).rejects.toMatchObject({ status: 404 });
});

test('upload API rejects excessive sizes and another actor cannot complete an upload', async ({ request, playwright, baseURL }) => {
    expect((await request.post('/api/comments/recordings', { data: { ...init(), size: 25 * 1024 * 1024 + 1 } })).status()).toBe(400);
    const own = await request.post('/api/comments/recordings', { data: init() });
    expect(own.ok()).toBe(true);
    const upload = await own.json();
    const other = await playwright.request.newContext({ baseURL });
    try { expect((await other.post(`/api/comments/recordings/${upload.id}/complete`)).status()).toBe(404); }
    finally { await other.dispose(); }
    expect((await request.post('/api/projects/fixture/recordings', { headers: { Origin: 'https://stranger.example', 'Sec-Fetch-Site': 'cross-site' }, data: init() })).status()).toBe(403);
    expect((await request.post('/api/projects/fixture/recordings/recording_fixture/complete', { headers: { Origin: 'https://stranger.example', 'Sec-Fetch-Site': 'cross-site' } })).status()).toBe(403);
    expect((await request.get('/api/projects/fixture/comments/comment_fixture/recording')).status()).toBe(401);
});

test('project recording routes enforce private visibility, project identity, site origins and comments-disabled policy', async () => {
    const project = await ensureProjectPublicId(await persistProjectAccess({ id: randomUUID().replaceAll('-', '').slice(0, 12) } as DbProject));
    const domain = `project:${project.id}`, f = await serviceUpload(domain, 'user:member');
    const recording = await prepareCommentRecording(domain, f.author, f.upload.id, f.store);
    const comment: DbComment = { id: `comment_${randomUUID()}`, domain, projectId: project.id, private: true, authorId: f.author, path: '/', position: { type: 'page' },
        recording: f.metadata, thread: { items: [{ id: 'first', text: 'Private evidence', authorId: f.author }] } };
    await commitNewSubmission(f.store, submission(domain, f.author, randomUUID(), { recordingId: f.upload.id })!, comment, undefined, attachRecording(recording, comment.id));
    const ownerHeaders = { Authorization: `Bearer ${signToken('review', { uid: 'member', pid: project.id }, 600)}` };
    const readUrl = `http://localhost:4004/api/review/${project.publicId}/comments/${comment.id}/recording`;
    const params = { params: Promise.resolve({ projectId: project.publicId, id: comment.id }) };
    expect((await reviewRead(new Request(readUrl, { headers: ownerHeaders }), params)).status).toBe(200);
    expect((await reviewRead(new Request(readUrl), params)).status).toBe(404);
    expect((await reviewRead(new Request(readUrl, { headers: { 'X-Uier-Visitor': randomToken() } }), params)).status).toBe(404);
    expect((await reviewRead(new Request(readUrl, { headers: { ...ownerHeaders, Origin: 'https://stranger.example' } }), params)).status).toBe(403);
    const otherProject = await ensureProjectPublicId(await persistProjectAccess({ id: randomUUID().replaceAll('-', '').slice(0, 12) } as DbProject));
    expect((await reviewRead(new Request(readUrl, { headers: ownerHeaders }), { params: Promise.resolve({ projectId: otherProject.publicId, id: comment.id }) })).status).toBe(404);
    const completeParams = { params: Promise.resolve({ projectId: project.publicId, id: f.upload.id }) };
    expect((await reviewComplete(new Request(readUrl, { method: 'POST', headers: { 'X-Uier-Visitor': randomToken() } }), completeParams)).status).toBe(404);
    const app = getAppStore(), saved = (await app.get<DbProject>(project.pk, project.id))!;
    await app.replace({ ...saved.doc, access: 'disabled' }, saved.etag);
    const write = () => new Request(`http://localhost:4004/api/review/${project.publicId}/recordings`, { method: 'POST', headers: { ...ownerHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(init()) });
    const denied = await reviewStart(write(), { params: Promise.resolve({ projectId: project.publicId }) });
    expect(denied.status).toBe(403);
    expect((await denied.json() as { error: string }).error).toBe('comments_disabled');
    expect((await reviewComplete(write(), completeParams)).status).toBe(403);
});
