import { createHash } from 'node:crypto';
import { BlobServiceClient, BlobSASPermissions, generateBlobSASQueryParameters, SASProtocol, StorageSharedKeyCredential } from '@azure/storage-blob';
import { azureDataCredential } from '../azureCredential';
import { isCosmosConfigured } from '../db/client';
import { isLocalRuntime } from '../comments/environment';
import { apiErrors } from '../comments/http';
import { signToken, verifyToken } from '../app/tokens';

export const MAX_RECORDING_BYTES = 25 * 1024 * 1024;
export const recordingReadLifetimeSeconds = 60;
export type RecordingBlobs = {
    uploadUrl(name: string, contentType: string, request: Request): Promise<{ uploadUrl: string; headers: Record<string, string> }>;
    read(name: string, maxBytes?: number): Promise<Buffer>;
    put(name: string, bytes: Buffer, contentType: string): Promise<void>;
    delete(name: string): Promise<void>;
    url(name: string, request: Request): Promise<{ url: string; expiresAt: string }>;
};
export function recordingNames(domain: string, id: string) {
    const base = `recordings/${createHash('sha256').update(domain).digest('hex')}/${id}`;
    return { pending: `${base}/pending`, video: `${base}/video` };
}
const localFiles = globalThis as typeof globalThis & { __uierRecordingFiles?: Map<string, { bytes: Buffer; contentType: string }> };
const files = () => localFiles.__uierRecordingFiles ??= new Map();
const useMemory = () => isLocalRuntime() && !isCosmosConfigured();
function localUrl(request: Request, name: string, action: 'read' | 'write', seconds: number) {
    // Next's internal Request.url may use localhost even when the request targets a local
    // review subdomain. Preserve the API's incoming Host, as the existing comments routes do.
    const host = request.headers.get('host');
    const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'https' ? 'https' : 'http';
    const origin = host ? `${protocol}://${host}` : new URL(request.url).origin;
    const url = new URL(`/api/recording-files/${name.split('/').at(-2)}`, origin);
    url.searchParams.set('token', signToken('recording-file', { name, action }, seconds));
    return url.href;
}
export function createRecordingBlobs(service: BlobServiceClient, containerName: string): RecordingBlobs {
    const container = service.getContainerClient(containerName);
    async function signed(name: string, permissions: string, seconds: number) {
        const startsOn = new Date(Date.now() - 5 * 60_000), expiresOn = new Date(Date.now() + seconds * 1000);
        const options = { containerName, blobName: name, permissions: BlobSASPermissions.parse(permissions),
            protocol: SASProtocol.Https, startsOn, expiresOn, cacheControl: 'private, no-store' };
        const signature = service.credential instanceof StorageSharedKeyCredential
            ? generateBlobSASQueryParameters(options, service.credential)
            : generateBlobSASQueryParameters(options, await service.getUserDelegationKey(startsOn, expiresOn), service.accountName);
        return { url: `${container.getBlobClient(name).url}?${signature}`, expiresAt: expiresOn.toISOString() };
    }
    return {
        async uploadUrl(name, contentType) {
            return { uploadUrl: (await signed(name, 'cw', 600)).url,
                headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': contentType, 'If-None-Match': '*' } };
        },
        async read(name, maxBytes = MAX_RECORDING_BYTES) {
            const blob = container.getBlobClient(name), properties = await blob.getProperties();
            if (!properties.contentLength || properties.contentLength > maxBytes) throw apiErrors.tooLarge(maxBytes);
            return blob.downloadToBuffer(0, properties.contentLength, { conditions: { ifMatch: properties.etag } });
        },
        async put(name, bytes, contentType) {
            try {
                await container.getBlockBlobClient(name).uploadData(bytes, { conditions: { ifNoneMatch: '*' },
                    blobHTTPHeaders: { blobContentType: contentType, blobCacheControl: 'private, no-store', blobContentDisposition: 'inline' } });
            } catch (error) {
                // A final blob is immutable, including retries after an ambiguous upload response.
                if (!(error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 412)) throw error;
                if (!(await this.read(name)).equals(bytes)) throw apiErrors.conflict();
            }
        },
        async delete(name) { await container.getBlobClient(name).deleteIfExists(); },
        async url(name) { return signed(name, 'r', recordingReadLifetimeSeconds); }
    };
}
const stores = new Map<string, RecordingBlobs>();
export function getRecordingBlobs(containerOverride?: string): RecordingBlobs {
    if (useMemory()) return {
        async uploadUrl(name, contentType, request) { return { uploadUrl: localUrl(request, name, 'write', 600), headers: { 'Content-Type': contentType } }; },
        async read(name, maxBytes = MAX_RECORDING_BYTES) {
            const file = files().get(name);
            if (!file) throw apiErrors.notFound('Recording not found.');
            if (file.bytes.length > maxBytes) throw apiErrors.tooLarge(maxBytes);
            return file.bytes;
        },
        async put(name, bytes, contentType) {
            const previous = files().get(name);
            if (previous && !previous.bytes.equals(bytes)) throw apiErrors.conflict();
            if (!previous && [...files().values()].reduce((sum, file) => sum + file.bytes.length, 0) + bytes.length > 100 * 1024 * 1024)
                throw apiErrors.unavailable('Local recording storage is full.');
            files().set(name, { bytes: Buffer.from(bytes), contentType });
        },
        async delete(name) { files().delete(name); },
        async url(name, request) {
            return { url: localUrl(request, name, 'read', recordingReadLifetimeSeconds), expiresAt: new Date(Date.now() + recordingReadLifetimeSeconds * 1000).toISOString() };
        }
    };
    const container = containerOverride ?? process.env.AZURE_SCREENSHOTS_CONTAINER;
    if (!container) throw new Error('Recording storage requires the configured screenshot container.');
    const cached = stores.get(container);
    if (cached) return cached;
    const connection = process.env.AZURE_SCREENSHOTS_CONNECTION_STRING, endpoint = process.env.AZURE_SCREENSHOTS_ENDPOINT;
    if (!connection && !endpoint) throw new Error('Recording Blob Storage is not configured.');
    const service = connection ? BlobServiceClient.fromConnectionString(connection) : new BlobServiceClient(endpoint!, azureDataCredential());
    const store = createRecordingBlobs(service, container);
    stores.set(container, store);
    return store;
}

/** Local/test capability URLs mirror direct Azure uploads. They never accept deployment traffic. */
export async function localRecordingFile(request: Request, id: string) {
    if (!useMemory()) throw apiErrors.notFound();
    const token = verifyToken<{ name: string; action: string }>('recording-file', new URL(request.url).searchParams.get('token'));
    if (!token || typeof token.name !== 'string' || token.name.split('/').at(-2) !== id
        || token.action !== (request.method === 'PUT' ? 'write' : 'read')) throw apiErrors.notFound();
    const blobs = getRecordingBlobs();
    if (request.method === 'PUT') {
        if (!request.body) throw apiErrors.invalidRequest('Recording bytes are required.');
        const reader = request.body.getReader(), chunks: Uint8Array[] = [];
        let length = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > MAX_RECORDING_BYTES) { await reader.cancel(); throw apiErrors.tooLarge(MAX_RECORDING_BYTES); }
            chunks.push(value);
        }
        await blobs.put(token.name, Buffer.concat(chunks), request.headers.get('content-type') ?? 'application/octet-stream');
        return new Response(null, { status: 201 });
    }
    const file = files().get(token.name);
    if (!file) throw apiErrors.notFound();
    const headers = new Headers({ 'Content-Type': file.contentType, 'Content-Length': String(file.bytes.length),
        'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes', 'Referrer-Policy': 'no-referrer' });
    const range = request.headers.get('range');
    if (range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range);
        const start = match ? Number(match[1]) : NaN, end = match?.[2] ? Math.min(Number(match[2]), file.bytes.length - 1) : file.bytes.length - 1;
        if (!Number.isSafeInteger(start) || start < 0 || start > end) return new Response(null, { status: 416, headers });
        headers.set('Content-Range', `bytes ${start}-${end}/${file.bytes.length}`);
        headers.set('Content-Length', String(end - start + 1));
        return new Response(new Uint8Array(file.bytes.subarray(start, end + 1)), { status: 206, headers });
    }
    return new Response(new Uint8Array(file.bytes), { headers });
}
