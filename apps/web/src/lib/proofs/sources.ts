import sharp from 'sharp';
import { ApiError } from '../comments/http';
import { MAX_PROOF_UPLOAD_BYTES, PROOF_UPLOAD_CONTENT_TYPES, type ProofFormat, type ProofManifest } from './model';

export const MAX_PROOF_ARTIFACTS = 128;
export const MAX_PROOF_DERIVATIVE_BYTES = 80 * 1024 * 1024;
export const proofArtifactIdPattern = /^[A-Za-z0-9_-]{1,120}$/;

/** Inline media on the app origin excludes active formats. Embedded HTML needs a separate origin. */
export const proofInlineTypes = new Set<string>([
    ...PROOF_UPLOAD_CONTENT_TYPES, 'application/pdf', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/ogg'
]);

export type ProofSource = {
    bytes: Buffer;
    filename: string;
    contentType: string;
    signal: AbortSignal;
};
export type ProofSourceResult = {
    manifest: ProofManifest;
    artifacts: { id: string; contentType: string; bytes: Buffer }[];
};
export type ProofSourceAdapter = {
    format: ProofFormat;
    contentTypes: readonly string[];
    ingest(source: ProofSource): Promise<ProofSourceResult>;
};

/** A terminal input/conversion error. Unknown errors remain retryable on the same upload. */
export class ProofSourceError extends ApiError {
    constructor(message: string) {
        super(422, 'invalid_request', message);
    }
}

const imageTypes: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const inputPixels = 24_000_000;

const image: ProofSourceAdapter = {
    format: 'image',
    contentTypes: PROOF_UPLOAD_CONTENT_TYPES,
    async ingest({ bytes, contentType, signal }) {
        try {
            signal.throwIfAborted();
            const pipeline = sharp(bytes, { animated: true, failOn: 'warning', limitInputPixels: inputPixels }).timeout({ seconds: 20 });
            const metadata = await pipeline.metadata();
            if (!metadata.format || imageTypes[metadata.format] !== contentType
                || !metadata.width || !metadata.height || metadata.width * metadata.height > inputPixels || (metadata.pages ?? 1) > 160)
                throw new ProofSourceError('The image format or dimensions do not match a supported upload.');
            if ((metadata.pages ?? 1) === 1) pipeline.autoOrient();
            // Decode the actual pixels and re-encode without metadata before serving them on the app origin.
            const { data, info } = await pipeline.webp({ lossless: true }).toBuffer({ resolveWithObject: true });
            signal.throwIfAborted();
            if (data.length > MAX_PROOF_UPLOAD_BYTES) throw new ProofSourceError('The image preview is too large.');
            return {
                manifest: { format: 'image', surfaces: [{ id: 'image', artifactId: 'image', width: info.width, height: info.pageHeight ?? info.height }],
                    ...(metadata.delay ? { durationMs: metadata.delay.reduce((total, delay) => total + delay, 0) } : {}) },
                artifacts: [{ id: 'image', contentType: 'image/webp', bytes: data }]
            };
        } catch (error) {
            if (signal.aborted) throw error;
            if (error instanceof ProofSourceError) throw error;
            throw new ProofSourceError('The image could not be decoded safely.');
        }
    }
};

// Register source adapters here so web requests and the background worker run the same processors.
const adapters: readonly ProofSourceAdapter[] = [image];

export function getProofSourceAdapter(contentType: string, formats: readonly ProofFormat[]) {
    return adapters.find(adapter => formats.includes(adapter.format) && adapter.contentTypes.includes(contentType));
}

export async function ingestProofBytes(adapter: ProofSourceAdapter, source: ProofSource): Promise<ProofSourceResult> {
    const result = await adapter.ingest(source);
    if (result.manifest.format !== adapter.format || !result.artifacts.length || result.artifacts.length > MAX_PROOF_ARTIFACTS
        || !result.manifest.surfaces.length || result.manifest.surfaces.length > MAX_PROOF_ARTIFACTS
        || (result.manifest.durationMs !== undefined && (!Number.isFinite(result.manifest.durationMs) || result.manifest.durationMs < 0)))
        throw new ProofSourceError('The generated preview exceeds the supported limits.');
    const ids = new Set<string>();
    let size = 0;
    for (const item of result.artifacts) {
        size += item.bytes.length;
        if (!proofArtifactIdPattern.test(item.id) || ids.has(item.id) || !proofInlineTypes.has(item.contentType)
            || item.bytes.length < 1 || item.bytes.length > MAX_PROOF_UPLOAD_BYTES || size > MAX_PROOF_DERIVATIVE_BYTES)
            throw new ProofSourceError('The generated preview is invalid.');
        ids.add(item.id);
    }
    const surfaces = new Set<string>();
    for (const surface of result.manifest.surfaces) {
        if (!proofArtifactIdPattern.test(surface.id) || surfaces.has(surface.id) || (surface.artifactId && !ids.has(surface.artifactId))
            || [surface.width, surface.height].some(value => value !== undefined && (!Number.isFinite(value) || value <= 0))
            || (surface.label !== undefined && surface.label.length > 240))
            throw new ProofSourceError('The preview layout is invalid.');
        surfaces.add(surface.id);
    }
    return result;
}
