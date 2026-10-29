import { expect, test } from '@playwright/test';
import type { Container } from '@azure/cosmos';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { createCosmosCommentsStore } from '../src/lib/repo/cosmosCommentsStore';
import { createScreenshotBlobStore, screenshotBytes, type ScreenshotBlobStore } from '../src/lib/screenshots/blobStore';
import { screenshotDocumentId, type DbComment, type DbScreenshot } from '../src/lib/db/schema';
import { screenshotResponse } from '../src/lib/comments/screenshot';

const image: DbScreenshot = { id: screenshotDocumentId('comment_test'), type: 'screenshot', domain: 'project:fixture', commentId: 'comment_test',
    data: Buffer.from('sanitized pixels').toString('base64'), contentType: 'image/png', width: 1, height: 1, bytes: 16, createdAt: new Date().toISOString() };
const comment: DbComment = { id: image.commentId, domain: image.domain, path: '/', position: { type: 'page' }, thread: { items: [{ id: 'first', text: 'Keep feedback' }] },
    screenshot: { contentType: image.contentType, width: 1, height: 1, bytes: 16 } };

function fixture(defaultTtl = -1) {
    const documents = new Map<string, { value: Record<string, unknown>; etag: string }>();
    const blobs = new Map<string, DbScreenshot>();
    let version = 0, upload = 0;
    const key = (domain: string, id: string) => `${domain}:${id}`;
    const save = (doc: Record<string, unknown>) => documents.set(key(String(doc.domain), String(doc.id)), { value: structuredClone(doc), etag: String(++version) });
    const fail = (code: number) => { throw Object.assign(new Error('Fixture failure'), { code }); };
    const controls = { loseAcknowledgement: false, failUpload: false, failDelete: false, conflictMigration: false };
    const storage: ScreenshotBlobStore = {
        async put(source) { if (controls.failUpload) throw new Error('Upload failed'); const name = `blob-${++upload}`; blobs.set(name, structuredClone(source)); return name; },
        async read(name) { return Buffer.from(blobs.get(name)!.data!, 'base64'); },
        async delete(name) { if (controls.failDelete) throw new Error('Delete failed'); blobs.delete(name); },
        async url(name) { return { url: `https://fixture.blob.core.windows.net/screenshots/${name}?sp=r`, expiresAt: new Date(Date.now() + 60_000).toISOString() }; },
        async listBefore() { return { items: [...blobs].map(([name, doc]) => ({ name, domain: doc.domain, commentId: doc.commentId, etag: name })) }; }
    };
    const container = {
        async read() { return { resource: { defaultTtl } }; },
        item(id: string, domain: string) {
            return {
                async read() { const doc = documents.get(key(domain, id)); return doc ? { resource: structuredClone(doc.value), etag: doc.etag } : fail(404); },
                async replace(value: Record<string, unknown>, options: { accessCondition: { condition: string } }) {
                    const current = documents.get(key(domain, id));
                    if (controls.conflictMigration) return fail(412);
                    if (!current) return fail(404);
                    if (current.etag !== options.accessCondition.condition) return fail(412);
                    save(value);
                },
                async delete(options: { accessCondition: { condition: string } }) {
                    const current = documents.get(key(domain, id));
                    if (!current) return fail(404);
                    if (current.etag !== options.accessCondition.condition) return fail(412);
                    documents.delete(key(domain, id));
                }
            };
        },
        items: {
            async upsert(doc: Record<string, unknown>) { save(doc); },
            async create(doc: Record<string, unknown>) { if (documents.has(key(String(doc.domain), String(doc.id)))) return fail(409); save(doc); },
            query() { return { async fetchAll() { return { resources: [...documents.values()].filter(doc => typeof doc.value.data === 'string')
                .map(doc => ({ ...doc.value, _etag: doc.etag, _ts: Math.floor(Date.now() / 1000) - 3600 })) }; } }; },
            async batch(operations: { operationType: string; id?: string; resourceBody: Record<string, unknown>; ifMatch?: string }[], domain: string) {
                const conflict = operations.some(op => op.ifMatch && documents.get(key(domain, op.id!))?.etag !== op.ifMatch);
                if (conflict) return { code: 412, result: operations.map(() => ({ statusCode: 412 })) };
                for (const operation of operations) save(operation.resourceBody);
                if (controls.loseAcknowledgement) throw new Error('Response lost after commit');
                return { code: 200, result: operations.map(() => ({ statusCode: 200 })) };
            }
        }
    } as unknown as Container;
    return { store: createCosmosCommentsStore(() => container, () => storage), storage, documents, blobs, controls, save };
}

test('Cosmos stores only a Blob reference; legacy and local inline screenshots still read', async () => {
    const f = fixture();
    await f.store.createScreenshot(image);
    const saved = (await f.store.getScreenshot(image.domain, image.commentId))!;
    expect(saved.data).toBeUndefined();
    expect(saved.blob).toBe('blob-1');
    expect(await screenshotBytes(saved, f.storage)).toEqual(Buffer.from(image.data!, 'base64'));
    expect(await (await screenshotResponse(image)).arrayBuffer()).toEqual(Uint8Array.from(Buffer.from(image.data!, 'base64')).buffer);
    f.controls.failUpload = true;
    await expect(f.store.createScreenshot({ ...image, id: 'other', commentId: 'other' })).rejects.toThrow('Upload failed');
    expect(f.documents.size).toBe(1);
});

test('replacement conflicts preserve live pixels, and orphan sweep handles ambiguous commits and failed deletion', async () => {
    const f = fixture();
    await f.store.create(comment);
    await f.store.createScreenshot(image);
    const before = (await f.store.get(comment.domain, comment.id))!;
    expect(await f.store.replaceScreenshot(comment, 'stale', { ...image, revision: 'loser' })).toBe('conflict');
    expect((await f.store.getScreenshot(image.domain, image.commentId))?.blob).toBe('blob-1');
    f.controls.loseAcknowledgement = true;
    await expect(f.store.replaceScreenshot(comment, before.etag, { ...image, revision: 'winner' })).rejects.toThrow('Response lost');
    expect((await f.store.getScreenshot(image.domain, image.commentId))?.blob).toBe('blob-3');
    await f.store.sweepScreenshotBlobs!(Date.now() + 2 * 60 * 60_000);
    expect([...f.blobs.keys()]).toEqual(['blob-3']);
    f.controls.failDelete = true;
    await expect(f.store.deleteScreenshot(image.domain, image.commentId)).rejects.toThrow('Delete failed');
    expect(await f.store.getScreenshot(image.domain, image.commentId)).toBeNull();
    f.controls.failDelete = false;
    await f.store.sweepScreenshotBlobs!(Date.now() + 4 * 60 * 60_000);
    expect(f.blobs.size).toBe(0);
});

test('successful redaction removes old pixels, and stale cleanup cannot remove a replacement', async () => {
    const f = fixture();
    await f.store.create(comment);
    await f.store.createScreenshot(image);
    const staleImageEtag = f.documents.get(`${image.domain}:${image.id}`)!.etag;
    const saved = (await f.store.get(comment.domain, comment.id))!;
    expect(await f.store.replaceScreenshot(comment, saved.etag, { ...image, revision: 'redacted' })).toBe('ok');
    expect([...f.blobs.keys()]).toEqual(['blob-2']);
    await f.store.deleteScreenshot(image.domain, image.commentId, staleImageEtag);
    expect((await f.store.getScreenshot(image.domain, image.commentId))?.revision).toBe('redacted');
    expect([...f.blobs.keys()]).toEqual(['blob-2']);
});

test('backfill keeps revision and remaining TTL, including the preview container default', async () => {
    for (const ttl of [undefined, -1, 7200]) {
        const f = fixture(604800);
        f.save({ ...image, revision: 'stable', ...(ttl !== undefined ? { ttl } : {}) });
        expect(await f.store.migrateScreenshots!()).toEqual({ migrated: 1, failed: 0 });
        const saved = (await f.store.getScreenshot(image.domain, image.commentId))!;
        expect(saved.data).toBeUndefined();
        expect(saved.revision).toBe('stable');
        expect(saved.ttl).toBe(ttl === -1 ? -1 : (ttl ?? 604800) - 3600);
    }
});

test('Blob uploads use raw bytes, private caching and immutable names; SAS permits HTTPS reads for one minute', async () => {
    const uploads: { name: string; bytes: Buffer; options: unknown }[] = [];
    const service = {
        accountName: 'fixture', credential: new StorageSharedKeyCredential('fixture', Buffer.alloc(32, 1).toString('base64')),
        getContainerClient() { return {
            getBlockBlobClient(name: string) { return { async uploadData(bytes: Buffer, options: unknown) { uploads.push({ name, bytes, options }); } }; },
            getBlobClient(name: string) { return { url: `https://fixture.blob.core.windows.net/screenshots/${name}` }; }
        }; }
    } as unknown as BlobServiceClient;
    const blobs = createScreenshotBlobStore(service, 'screenshots');
    const names = await Promise.all([blobs.put(image), blobs.put(image)]);
    expect(names[0]).not.toBe(names[1]);
    expect(uploads[0]!.bytes).toEqual(Buffer.from(image.data!, 'base64'));
    expect(uploads[0]!.options).toMatchObject({ conditions: { ifNoneMatch: '*' }, blobHTTPHeaders: { blobCacheControl: 'private, no-store' } });
    const signed = await blobs.url(names[0]!);
    const url = new URL(signed.url);
    expect(url.searchParams.get('sp')).toBe('r');
    expect(url.searchParams.get('spr')).toBe('https');
    expect(url.searchParams.get('sr')).toBe('b');
    expect(new Date(signed.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(60_000);
    expect(new Date(signed.expiresAt).getTime() - Date.now()).toBeGreaterThan(55_000);
    expect(url.searchParams.has('sig')).toBe(true);
});


test('URL negotiation is private and temporary, while byte delivery stays compatible', async () => {
    const f = fixture();
    await f.store.createScreenshot(image);
    const saved = (await f.store.getScreenshot(image.domain, image.commentId))!;
    const response = await screenshotResponse(saved, 'url', f.storage);
    expect(response.headers.get('content-type')).toContain('application/vnd.uier.screenshot-url+json');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await response.json()).toMatchObject({ url: expect.stringContaining('blob.core.windows.net/screenshots/blob-1') });
    const redirected = await screenshotResponse(saved, 'redirect', f.storage);
    expect(redirected.status).toBe(307);
    expect(redirected.headers.get('location')).toContain('/screenshots/blob-1');
    expect((await screenshotResponse(saved, 'bytes', f.storage)).headers.get('content-type')).toBe('image/png');
});

test('Blob sweep resumes one page per tick and waits an hour after a complete pass', async () => {
    const f = fixture();
    const cursors: (string | undefined)[] = [];
    f.storage.listBefore = async (_, cursor) => {
        cursors.push(cursor);
        return { items: [], continuation: cursor ? undefined : 'second-page' };
    };
    const now = Date.now();
    await f.store.sweepScreenshotBlobs!(now);
    await f.store.sweepScreenshotBlobs!(now + 60_000);
    await f.store.sweepScreenshotBlobs!(now + 2 * 60_000);
    expect(cursors).toEqual([undefined, 'second-page']);
    await f.store.sweepScreenshotBlobs!(now + 62 * 60_000);
    expect(cursors).toEqual([undefined, 'second-page', undefined]);
});

test('failed and conflicting backfills retain inline data; abandoned uploads are swept', async () => {
    const f = fixture();
    f.save(image);
    await f.store.create(comment);
    f.controls.failUpload = true;
    expect(await f.store.migrateScreenshots!()).toEqual({ migrated: 0, failed: 1 });
    expect((await f.store.getScreenshot(image.domain, image.commentId))?.data).toBe(image.data);
    f.controls.failUpload = false;
    f.controls.conflictMigration = true;
    expect(await f.store.migrateScreenshots!()).toEqual({ migrated: 0, failed: 0 });
    expect((await f.store.getScreenshot(image.domain, image.commentId))?.data).toBe(image.data);
    expect(f.blobs.size).toBe(1);
    await f.store.sweepScreenshotBlobs!(Date.now() + 2 * 60 * 60_000);
    expect(f.blobs.size).toBe(0);
});
