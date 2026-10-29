import { createHash, randomUUID } from 'node:crypto';
import { ClientAssertionCredential } from '@azure/identity';
import { getVercelOidcToken } from '@vercel/oidc';
import { BlobServiceClient, BlobSASPermissions, SASProtocol, StorageSharedKeyCredential, generateBlobSASQueryParameters, type UserDelegationKey, type BlobItem } from '@azure/storage-blob';
import type { DbScreenshot } from '../db/schema';

export const screenshotUrlMediaType = 'application/vnd.uier.screenshot-url+json';
export const screenshotUrlLifetimeMs = 60_000;
export type ScreenshotBlob = { name: string; domain: string; commentId: string; etag: string };
export type ScreenshotBlobStore = {
    put(image: DbScreenshot): Promise<string>;
    read(name: string): Promise<Buffer>;
    delete(name: string, etag?: string): Promise<void>;
    url(name: string): Promise<{ url: string; expiresAt: string }>;
    listBefore(before: Date, continuation?: string): Promise<{ items: ScreenshotBlob[]; continuation?: string }>;
};

/** Immutable names let the Cosmos transaction publish a reference without overwriting live pixels. */
export function createScreenshotBlobStore(service: BlobServiceClient, containerName: string): ScreenshotBlobStore {
    const container = service.getContainerClient(containerName);
    let delegation: Promise<UserDelegationKey> | undefined;
    let delegationExpires = 0;
    return {
        async put(image) {
            const bytes = image.data !== undefined ? Buffer.from(image.data, 'base64') : await container.getBlobClient(image.blob).downloadToBuffer();
            const partition = createHash('sha256').update(image.domain).digest('hex');
            const name = `${partition}/${image.commentId}/${randomUUID()}`;
            await container.getBlockBlobClient(name).uploadData(bytes, {
                conditions: { ifNoneMatch: '*' },
                blobHTTPHeaders: { blobContentType: image.contentType, blobCacheControl: 'private, no-store', blobContentDisposition: 'inline' },
                metadata: { domain: Buffer.from(image.domain).toString('base64url'), commentid: image.commentId }
            });
            return name;
        },
        async read(name) { return container.getBlobClient(name).downloadToBuffer(); },
        async delete(name, etag) {
            try { await container.getBlobClient(name).deleteIfExists({ conditions: etag ? { ifMatch: etag } : undefined }); }
            catch (error) {
                if (!(error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 412)) throw error;
            }
        },
        async url(name) {
            const now = Date.now();
            const expiresOn = new Date(now + screenshotUrlLifetimeMs);
            const options = { containerName, blobName: name, permissions: BlobSASPermissions.parse('r'), protocol: SASProtocol.Https,
                startsOn: new Date(now - 5 * 60_000), expiresOn, cacheControl: 'private, no-store', contentDisposition: 'inline' };
            let signature: string;
            if (service.credential instanceof StorageSharedKeyCredential) {
                signature = generateBlobSASQueryParameters(options, service.credential).toString();
            } else {
                if (!delegation || delegationExpires < now + 2 * screenshotUrlLifetimeMs) {
                    delegationExpires = now + 15 * 60_000;
                    delegation = service.getUserDelegationKey(options.startsOn, new Date(delegationExpires));
                    delegation.catch(() => { delegation = undefined; });
                }
                signature = generateBlobSASQueryParameters(options, await delegation, service.accountName).toString();
            }
            return { url: `${container.getBlobClient(name).url}?${signature}`, expiresAt: expiresOn.toISOString() };
        },
        async listBefore(before, continuation) {
            const page = await container.listBlobsFlat({ includeMetadata: true }).byPage({ continuationToken: continuation, maxPageSize: 100 }).next();
            const items = (page.value?.segment.blobItems as BlobItem[] ?? []).flatMap(item => {
                if (!item.properties.createdOn || item.properties.createdOn >= before || !item.properties.etag || !item.metadata?.domain || !item.metadata.commentid) return [];
                return [{ name: item.name, domain: Buffer.from(item.metadata.domain, 'base64url').toString(), commentId: item.metadata.commentid, etag: item.properties.etag }];
            });
            return { items, continuation: page.value?.continuationToken || undefined };
        }
    };
}

const stores = new Map<string, ScreenshotBlobStore>();
/** Production uses its server-only key; previews use OIDC with rights only on screenshots-preview. */
export function getScreenshotBlobStore(containerOverride?: string): ScreenshotBlobStore {
    const container = containerOverride ?? process.env.AZURE_SCREENSHOTS_CONTAINER;
    if (!container) throw new Error('AZURE_SCREENSHOTS_CONTAINER is required for screenshot storage.');
    const cached = stores.get(container);
    if (cached) return cached;
    const connection = process.env.AZURE_SCREENSHOTS_CONNECTION_STRING;
    const endpoint = process.env.AZURE_SCREENSHOTS_ENDPOINT;
    let service: BlobServiceClient;
    if (connection) service = BlobServiceClient.fromConnectionString(connection);
    else {
        const tenant = process.env.AZURE_TENANT_ID;
        const client = process.env.AZURE_CLIENT_ID;
        if (!endpoint || !tenant || !client) throw new Error('Screenshot Blob Storage requires its endpoint and Azure identity.');
        service = new BlobServiceClient(endpoint, new ClientAssertionCredential(tenant, client, () => getVercelOidcToken()));
    }
    const store = createScreenshotBlobStore(service, container);
    stores.set(container, store);
    return store;
}

export async function screenshotBytes(image: DbScreenshot, blobs?: ScreenshotBlobStore) {
    return image.data !== undefined ? Buffer.from(image.data, 'base64') : (blobs ?? getScreenshotBlobStore()).read(image.blob);
}

export async function storeScreenshotBytes(image: DbScreenshot, blobs: ScreenshotBlobStore): Promise<Omit<DbScreenshot, 'data' | 'blob'> & { blob: string }> {
    const name = await blobs.put(image);
    const { data: _, blob: __, ...metadata } = image;
    return { ...metadata, blob: name };
}
