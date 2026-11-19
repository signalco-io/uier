import { Readable } from 'node:stream';
import {
    BlobServiceClient, BlobSASPermissions, generateBlobSASQueryParameters, SASProtocol, StorageSharedKeyCredential, type UserDelegationKey
} from '@azure/storage-blob';
import { azureDataCredential } from '../azureCredential';
import { isLocalRuntime } from '../comments/environment';
import { isCosmosConfigured } from '../db/client';
import { apiErrors } from '../comments/http';
import { proofConflict, proofNotFound, type DbProofVersion } from './store';
import { MAX_PROOF_UPLOAD_BYTES } from './model';

export const proofBlobRoot = 'proofs/';
export const proofProjectPrefix = (projectId: string) => `${proofBlobRoot}${projectId}/`;
export const proofAssetPrefix = (projectId: string, assetId: string) => `${proofProjectPrefix(projectId)}${assetId}/`;
export const proofVersionPrefix = ({ projectId, assetId, id }: Pick<DbProofVersion, 'projectId' | 'assetId' | 'id'>) =>
    `${proofAssetPrefix(projectId, assetId)}${id}/`;
export const proofStagedBlob = (version: DbProofVersion) => `${proofVersionPrefix(version)}staged`;
export const proofAttemptPrefix = (version: DbProofVersion, attemptId: string) => `${proofVersionPrefix(version)}runs/${attemptId}/`;

export type ByteRange = { offset: number; length: number };
type BlobEntry = { name: string; updatedAt: Date };
type UploadGrant = { uploadUrl: string; headers: Record<string, string> };
export type ProofBlobs = {
    uploadGrant?(name: string, contentType: string, expiresAt: Date): Promise<UploadGrant>;
    hasStaged(name: string): Promise<boolean>;
    /** Missing returns null. Declared and actual bytes must agree before decoding. */
    readStaged(name: string, expectedSize: number, signal?: AbortSignal): Promise<Buffer | null>;
    put(name: string, bytes: Buffer, contentType: string, signal?: AbortSignal): Promise<void>;
    open(name: string, range?: ByteRange, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>>;
    delete(name: string): Promise<void>;
    list(prefix: string): AsyncIterable<BlobEntry>;
};

function hasStatus(error: unknown, ...statuses: number[]) {
    return Boolean(error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' && statuses.includes(error.statusCode));
}

export function createAzureProofBlobs(service: BlobServiceClient, containerName: string): ProofBlobs {
    const container = service.getContainerClient(containerName);
    let delegation: Promise<UserDelegationKey> | undefined;
    let delegationExpires = 0;
    return {
        async uploadGrant(name, contentType, expiresOn) {
            const now = Date.now();
            const startsOn = new Date(now - 5 * 60_000);
            const options = { containerName, blobName: name, permissions: BlobSASPermissions.parse('c'),
                protocol: SASProtocol.Https, startsOn, expiresOn };
            let signature;
            if (service.credential instanceof StorageSharedKeyCredential) {
                signature = generateBlobSASQueryParameters(options, service.credential);
            } else {
                if (!delegation || delegationExpires < expiresOn.getTime()) {
                    delegationExpires = now + 20 * 60_000;
                    const requested = service.getUserDelegationKey(startsOn, new Date(delegationExpires));
                    delegation = requested;
                    requested.catch(() => { if (delegation === requested) delegation = undefined; });
                }
                signature = generateBlobSASQueryParameters(options, await delegation, service.accountName);
            }
            return { uploadUrl: `${container.getBlobClient(name).url}?${signature}`,
                headers: { 'Content-Type': contentType, 'x-ms-blob-type': 'BlockBlob', 'If-None-Match': '*' } };
        },
        async hasStaged(name) { return container.getBlobClient(name).exists(); },
        async readStaged(name, expectedSize, abortSignal) {
            const blob = container.getBlobClient(name);
            try {
                const properties = await blob.getProperties({ abortSignal });
                if (properties.contentLength !== expectedSize || expectedSize > MAX_PROOF_UPLOAD_BYTES || properties.blobType !== 'BlockBlob')
                    throw apiErrors.invalidRequest('The uploaded file size or Blob type does not match the grant.');
                return await blob.downloadToBuffer(0, expectedSize, { conditions: { ifMatch: properties.etag }, abortSignal });
            } catch (error) {
                if (hasStatus(error, 404)) return null;
                throw error;
            }
        },
        async put(name, bytes, contentType, abortSignal) {
            try {
                await container.getBlockBlobClient(name).uploadData(bytes, { conditions: { ifNoneMatch: '*' }, abortSignal,
                    blobHTTPHeaders: { blobContentType: contentType, blobCacheControl: 'private, no-store' } });
            } catch (error) {
                if (hasStatus(error, 409, 412)) throw proofConflict('The upload bytes already exist.');
                throw error;
            }
        },
        async open(name, range, abortSignal) {
            try {
                const download = await container.getBlobClient(name).download(range?.offset, range?.length, { abortSignal });
                if (!download.readableStreamBody) throw proofNotFound();
                return Readable.toWeb(download.readableStreamBody as Readable) as ReadableStream<Uint8Array>;
            } catch (error) {
                if (hasStatus(error, 404)) throw proofNotFound();
                throw error;
            }
        },
        async delete(name) { await container.getBlobClient(name).deleteIfExists(); },
        async *list(prefix) {
            for await (const blob of container.listBlobsFlat({ prefix })) {
                yield { name: blob.name, updatedAt: blob.properties.lastModified };
            }
        }
    };
}

export function createMemoryProofBlobs(): ProofBlobs {
    const files = new Map<string, { bytes: Buffer; updatedAt: Date }>();
    let size = 0;
    return {
        async hasStaged(name) { return files.has(name); },
        async readStaged(name, expectedSize, signal) {
            signal?.throwIfAborted();
            const file = files.get(name);
            if (!file) return null;
            if (file.bytes.length !== expectedSize) throw apiErrors.invalidRequest('The uploaded file size does not match the grant.');
            return Buffer.from(file.bytes);
        },
        async put(name, bytes, _contentType, signal) {
            signal?.throwIfAborted();
            if (files.has(name)) throw proofConflict('The upload bytes already exist.');
            if (size + bytes.length > 128 * 1024 * 1024) throw apiErrors.unavailable('Local proof storage is full.');
            files.set(name, { bytes: Buffer.from(bytes), updatedAt: new Date() });
            size += bytes.length;
        },
        async open(name, range, signal) {
            signal?.throwIfAborted();
            const file = files.get(name);
            if (!file) throw proofNotFound();
            const bytes = range ? file.bytes.subarray(range.offset, range.offset + range.length) : file.bytes;
            return new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.from(bytes)); controller.close(); } });
        },
        async delete(name) {
            size -= files.get(name)?.bytes.length ?? 0;
            files.delete(name);
        },
        async *list(prefix) {
            for (const [name, { updatedAt }] of files) if (name.startsWith(prefix)) yield { name, updatedAt };
        }
    };
}

const local = globalThis as typeof globalThis & { __uierProofBlobs?: ProofBlobs };
const azure = new Map<string, ProofBlobs>();
export function getProofBlobs(containerOverride?: string): ProofBlobs {
    if (isLocalRuntime() && !isCosmosConfigured() && !containerOverride)
        return local.__uierProofBlobs ??= createMemoryProofBlobs();
    const container = containerOverride ?? process.env.AZURE_SCREENSHOTS_CONTAINER;
    if (!container) throw new Error('Proof storage requires the private Azure Blob container.');
    const cached = azure.get(container);
    if (cached) return cached;
    const connection = process.env.AZURE_SCREENSHOTS_CONNECTION_STRING;
    const endpoint = process.env.AZURE_SCREENSHOTS_ENDPOINT;
    if (!connection && !endpoint) throw new Error('Proof Blob Storage is not configured.');
    const service = connection ? BlobServiceClient.fromConnectionString(connection) : new BlobServiceClient(endpoint!, azureDataCredential());
    const blobs = createAzureProofBlobs(service, container);
    azure.set(container, blobs);
    return blobs;
}
