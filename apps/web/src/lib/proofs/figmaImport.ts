import { z } from 'zod';
import { apiErrors } from '../comments/http';
import { isLocalRuntime } from '../comments/environment';
import { sha256Hex } from '../app/tokens';
import { authorizeProof } from './access';
import { figmaFileKey, figmaId, figmaSourceType, maxFigmaFrames } from './adapters/figma';
import { MAX_PROOF_UPLOAD_BYTES, type ProofFigmaChanges, type ProofFigmaFrame } from './model';
import { readProofBytes } from './sourceBytes';
import { getProofBlobs, proofStagedBlob } from './blobs';
import { ProofSourceError } from './sourceTypes';
import { proofConflict, proofEpoch, proofNotFound, proofStore } from './store';
import { beginAuthorizedProofUpload, finalizeAuthorizedProofUpload, proofUploadId, stageAuthorizedProofSource } from './uploads';

const sourceInput = {
    url: z.url().max(400), token: z.string().regex(/^[A-Za-z0-9_.-]{16,256}$/)
};
export const figmaFramesInput = z.strictObject(sourceInput);
export const figmaImportInput = z.strictObject({
    ...sourceInput, frameIds: z.array(figmaId).min(1).max(maxFigmaFrames),
    requestId: z.string().uuid(), expectedVersionId: z.string().regex(/^[a-f0-9]{32}$/).nullable()
});
const allowedNodes = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION']);
const maxDiscovery = 400;

function sourceKey(value: string) {
    const url = new URL(value);
    const match = /^\/(?:design|file|proto)\/([A-Za-z0-9]+)(?:\/|$)/.exec(url.pathname);
    const key = figmaFileKey.safeParse(match?.[1]);
    if (url.protocol !== 'https:' || !['figma.com', 'www.figma.com'].includes(url.host) || url.username || url.password || !key.success)
        throw apiErrors.invalidRequest('Paste a Figma Design link.');
    return key.data;
}

function localStub() {
    const value = isLocalRuntime() ? process.env.UIER_PROOF_FIGMA_TEST_ORIGIN : undefined;
    return value && /^http:\/\/127\.0\.0\.1:\d+$/.test(value) ? value : undefined;
}

async function figmaRequest(path: string, token: string, signal: AbortSignal) {
    const response = await fetch((localStub() ?? 'https://api.figma.com') + path, {
        headers: { 'X-Figma-Token': token }, redirect: 'error', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)])
    }).catch(() => { throw apiErrors.unavailable('Figma could not be reached. Try again.'); });
    if ([401, 403, 404].includes(response.status)) throw apiErrors.forbidden('Figma did not grant access to this file. Check the token and file permissions.');
    if (response.status === 429) throw apiErrors.rateLimited('Figma rate limited this import. Try again shortly.', 60, 'too_fast');
    if (!response.ok) throw apiErrors.unavailable('Figma could not deliver the file. Try again.');
    let json: unknown;
    try { json = JSON.parse((await readProofBytes(response.body, 4 * 1024 * 1024)).toString('utf8')); }
    catch { throw new ProofSourceError('Figma returned an invalid or oversized document.'); }
    return json;
}

const nodeSchema = z.looseObject({ id: z.string(), type: z.string(), name: z.string(), visible: z.boolean().optional(), children: z.array(z.unknown()).optional() });
const cleanName = (name: string) => name.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim().slice(0, 140) || 'Untitled frame';

async function loadFrames(key: string, token: string, signal: AbortSignal) {
    const payload = z.looseObject({ name: z.string(), version: z.string(), document: nodeSchema })
        .safeParse(await figmaRequest(`/v1/files/${key}?depth=5`, token, signal));
    if (!payload.success) throw new ProofSourceError('Figma did not return a supported design file.');
    const frames: ProofFigmaFrame[] = [];
    const pending = [{ node: payload.data.document, page: '' }];
    const ids = new Set<string>();
    while (pending.length) {
        const { node, page } = pending.pop()!;
        if (node.visible === false) continue;
        if (allowedNodes.has(node.type) && figmaId.safeParse(node.id).success && !ids.has(node.id)) {
            if (frames.length === maxDiscovery) throw new ProofSourceError('This Figma file has more than 400 discoverable frames.');
            ids.add(node.id);
            frames.push({ id: node.id, name: cleanName(node.name), page });
        }
        for (const value of [...node.children ?? []].reverse()) {
            const child = nodeSchema.safeParse(value);
            if (child.success) pending.push({ node: child.data, page: node.type === 'CANVAS' ? cleanName(node.name) : page });
        }
    }
    return { name: cleanName(payload.data.name), version: payload.data.version, frames };
}

export async function inspectProofFigma(request: Request, projectId: string, input: z.infer<typeof figmaFramesInput>) {
    const { project } = await authorizeProof(request, { projectId }, 'manage');
    if (!((await proofStore(project.id).guard())?.doc.formats ?? ['image']).includes('figma'))
        throw apiErrors.forbidden('Figma imports are paused for this project.');
    const { name, frames } = await loadFrames(sourceKey(input.url), input.token, request.signal);
    await authorizeProof(request, { projectId }, 'manage');
    return { name, frames };
}

function trustedExportUrl(value: string) {
    let url: URL;
    try { url = new URL(value); }
    catch { throw new ProofSourceError('Figma returned an invalid image address.'); }
    if (localStub() && url.origin === localStub()) return url.href;
    if (url.protocol !== 'https:' || url.port || url.username || url.password
        || !/^(?:s3-alpha(?:-sig)?\.figma\.com|figma-[a-z0-9-]+-api\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com)$/.test(url.hostname))
        throw new ProofSourceError('Figma returned an unsupported image host.');
    return url.href;
}

async function exportFrames(key: string, providerVersion: string, selected: ProofFigmaFrame[], token: string, signal: AbortSignal) {
    const params = new URLSearchParams({ ids: selected.map(frame => frame.id).join(','), version: providerVersion, scale: '1', format: 'png' });
    const payload = z.looseObject({ images: z.record(z.string(), z.string().nullable()) })
        .safeParse(await figmaRequest(`/v1/images/${key}?${params}`, token, signal));
    if (!payload.success) throw new ProofSourceError('Figma could not render the selected frames.');
    let total = 0;
    const frames = [];
    for (const frame of selected) {
        const link = payload.data.images[frame.id];
        if (!link) throw new ProofSourceError('Figma could not render one of the selected frames.');
        const response = await fetch(trustedExportUrl(link), {
            redirect: 'error', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)])
        }).catch(() => { throw apiErrors.unavailable('A Figma image could not be downloaded. Try again.'); });
        if (!response.ok) throw apiErrors.unavailable('A Figma image could not be downloaded. Try again.');
        const bytes = await readProofBytes(response.body, Math.min(5 * 1024 * 1024, 14 * 1024 * 1024 - total));
        total += bytes.length;
        if (!bytes.length) throw new ProofSourceError('Figma returned an empty frame.');
        frames.push({ id: frame.id, name: frame.name, png: bytes.toString('base64') });
    }
    return frames;
}

export async function importProofFigma(request: Request, projectId: string, assetId: string, input: z.infer<typeof figmaImportInput>) {
    const authorize = () => authorizeProof(request, { projectId, assetId }, 'manage');
    const { project, asset, actor } = await authorize();
    if (!asset || actor.kind !== 'member') throw proofNotFound();
    const proofs = proofStore(project.id);
    const guard = (await proofs.guard())?.doc;
    if (!(guard?.formats ?? ['image']).includes('figma')) throw apiErrors.forbidden('Figma imports are paused for this project.');
    const key = sourceKey(input.url);
    const unique = [...new Set(input.frameIds)];
    const sourceFingerprint = sha256Hex(JSON.stringify([key, unique, input.expectedVersionId]));
    const id = proofUploadId(project, proofEpoch(guard), assetId, actor.userId, input.requestId);
    const existing = (await proofs.version(id))?.doc;
    if (existing && existing.sourceFingerprint !== sourceFingerprint) throw proofConflict('That import request already used different frames or a different design.');
    if (!existing && asset.currentVersionId !== input.expectedVersionId) throw proofConflict('A newer version was published. Reload the file before resyncing.');
    const predecessor = input.expectedVersionId ? (await proofs.version(input.expectedVersionId))?.doc : undefined;
    const previous = predecessor?.manifest?.figma;
    if (previous && sourceKey(previous.url) !== key) throw proofConflict('Resync this asset with its original Figma design.');
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
    const { version, frames } = await loadFrames(key, input.token, signal);
    if (existing && (existing.status !== 'pending' || await getProofBlobs().hasStaged(proofStagedBlob(existing))))
        return finalizeAuthorizedProofUpload(projectId, assetId, existing.id, authorize);
    const byId = new Map(frames.map(frame => [frame.id, frame]));
    if (unique.some(id => !byId.has(id) && !previous?.selectedIds.includes(id))) throw new ProofSourceError('A selected frame is no longer available. Reload the Figma frame list.');
    const selected = unique.flatMap(id => byId.get(id) ?? []);
    if (!selected.length) throw new ProofSourceError('None of the selected Figma frames remain. The current review is still available.');
    const previousNames = new Map((predecessor?.manifest?.surfaces ?? []).flatMap(surface => {
        const id = surface.sourceUrl && new URL(surface.sourceUrl).searchParams.get('node-id');
        return id && surface.label ? [[id, surface.label] as const] : [];
    }));
    const changes: ProofFigmaChanges = {
        added: selected.filter(frame => !previousNames.has(frame.id)).map(frame => frame.id),
        renamed: selected.flatMap(frame => {
            const from = previousNames.get(frame.id);
            return from && from !== frame.name ? [{ id: frame.id, from, to: frame.name }] : [];
        }),
        removed: [...previousNames.keys()].filter(id => !selected.some(frame => frame.id === id))
    };
    const bytes = Buffer.from(JSON.stringify({ key, selectedIds: unique, changes, frames: await exportFrames(key, version, selected, input.token, signal) }));
    if (bytes.length > MAX_PROOF_UPLOAD_BYTES) throw apiErrors.tooLarge(MAX_PROOF_UPLOAD_BYTES);
    const grant = await beginAuthorizedProofUpload(projectId, assetId, {
        requestId: input.requestId, expectedVersionId: input.expectedVersionId, filename: 'figma-snapshot.json', contentType: figmaSourceType, size: bytes.length
    }, authorize, { sourceFingerprint });
    if (grant.version.status === 'pending') await stageAuthorizedProofSource(assetId, grant.version.id, bytes, authorize);
    return finalizeAuthorizedProofUpload(projectId, assetId, grant.version.id, authorize);
}
