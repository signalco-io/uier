import { imageAdapter } from './adapters/image';
import { pdfAdapter } from './adapters/pdf';
import { videoAdapter } from './adapters/video';
import { emailAdapter } from './adapters/email';
import { htmlAdapter } from './adapters/html';
import { figmaAdapter } from './adapters/figma';
import { MAX_PROOF_UPLOAD_BYTES, PROOF_UPLOAD_CONTENT_TYPES, type ProofFormat } from './model';
import { ProofSourceError, type ProofSourceAdapter, type ProofSource, type ProofSourceResult } from './sourceTypes';

export { ProofSourceError, type ProofSourceAdapter, type ProofSource, type ProofSourceResult } from './sourceTypes';
export const MAX_PROOF_ARTIFACTS = 128;
export const MAX_PROOF_DERIVATIVE_BYTES = 80 * 1024 * 1024;
export const proofArtifactIdPattern = /^[A-Za-z0-9_-]{1,120}$/;

// Email HTML is delivered as inert text. Prototype resources have their own origin and handler.
export const proofInlineTypes = new Set<string>([
    ...PROOF_UPLOAD_CONTENT_TYPES, 'application/pdf', 'application/json', 'video/mp4', 'video/webm', 'text/plain', 'text/html'
]);

const adapters: readonly ProofSourceAdapter[] = [imageAdapter, pdfAdapter, videoAdapter, emailAdapter, htmlAdapter, figmaAdapter];

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
        if (!proofArtifactIdPattern.test(item.id) || ids.has(item.id) || (!result.resources && !proofInlineTypes.has(item.contentType))
            || item.bytes.length < 1 || item.bytes.length > MAX_PROOF_UPLOAD_BYTES || size > MAX_PROOF_DERIVATIVE_BYTES)
            throw new ProofSourceError('The generated preview is invalid.');
        ids.add(item.id);
    }
    if (result.resources && (result.manifest.format !== 'html' || !result.manifest.html
        || !result.resources[result.manifest.html.entry] || Object.values(result.resources).length !== ids.size
        || Object.values(result.resources).some(id => !ids.has(id))))
        throw new ProofSourceError('The prototype resource index is invalid.');
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
