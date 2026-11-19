import { z } from 'zod';
import { assertAppOrigin } from '../app/avatarUpload';
import { MAX_PROOF_UPLOAD_BYTES, proofFormats } from './model';
import { ApiError, apiErrors, errorResponse, parseJsonBody } from '../comments/http';
import { authorizeProof, exchangeProofShare } from './access';
import { createProofShare, deleteProofAsset, deleteProofCollection, getProofAsset, listProofLibrary,
    listProofShares, proofFormatSettings, revokeProofShare, saveProofAsset, saveProofCollection } from './assets';
import { getProofBlobs, proofAttemptPrefix, type ByteRange } from './blobs';
import { beginProofUpload, finalizeProofUpload, putLocalProofUpload } from './uploads';
import { proofArtifactIdPattern, proofInlineTypes } from './sources';
import { figmaSourceType } from './adapters/figma';
import { figmaFramesInput, figmaImportInput, importProofFigma, inspectProofFigma } from './figmaImport';
import { proofEmailAddress } from './emailIngress';
import { openPrototype } from './prototype';
import { proofPreviewOrigin } from './previewOrigin';
import { proofNotFound } from './store';

const idPattern = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/;
const proofId = z.string().regex(idPattern);
const digestId = /^[0-9a-f]{64}$/;
const name = z.string().trim().min(1).max(160).regex(/^[^\p{Cc}\p{Cf}]*$/u);
const position = z.number().int().min(0).max(1_000_000_000);
const assetInput = z.strictObject({ name, collectionId: proofId.nullish(), position: position.optional() });
const collectionInput = z.strictObject({ name, position: position.optional() });
export const proofUploadInput = z.strictObject({
    requestId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
    expectedVersionId: proofId.nullable(),
    filename: z.string().trim().min(1).max(200).regex(/^[^/\\\p{Cc}\p{Cf}]+$/u),
    contentType: z.string().regex(/^[a-z0-9.+-]{1,50}\/[a-z0-9.+-]{1,70}$/),
    size: z.number().int().min(1)
});
const shareInput = z.strictObject({
    scope: z.strictObject({ kind: z.enum(['asset', 'collection']), id: proofId }),
    permission: z.enum(['view', 'comment']), downloadOriginal: z.boolean().optional(), expiresAt: z.iso.datetime().nullish()
});
const exchangeInput = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const settingsInput = z.strictObject({ formats: z.array(z.enum(proofFormats)).max(proofFormats.length) });

function validId(id: string) {
    if (!idPattern.test(id)) throw proofNotFound();
    return id;
}

function readRange(value: string | null, size: number): ByteRange | undefined {
    if (!value) return;
    const match = /^bytes=(\d{0,16})-(\d{0,16})$/.exec(value);
    if (match && (match[1] || match[2])) {
        const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
        const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end && start < size)
            return { offset: start, length: end - start + 1 };
    }
    throw new ApiError(416, 'invalid_request', 'The requested byte range is unavailable.');
}

// Some filenames contain apostrophes or Unicode. Use a conservative quoted fallback and RFC 5987.
function attachment(filename: string) {
    const fallback = filename.replace(/[^a-zA-Z0-9._ -]/g, '_');
    const encoded = encodeURIComponent(Buffer.from(filename).toString('utf8')).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

async function proofMedia(request: Request, projectId: string, assetId: string, versionId: string, artifactId?: string) {
    const original = artifactId === undefined;
    const { version } = await authorizeProof(request, { projectId, assetId, versionId }, original ? 'downloadOriginal' : 'view');
    if (!version?.publishedAttemptId) throw proofNotFound();
    const artifact = original ? null : version.artifacts.find(item => item.id === artifactId);
    if (!original && version.manifest?.format === 'pdf' && version.manifest.pdf?.rendition !== 'raster-ocr-v1') throw proofNotFound();
    if (!original && (!artifact || !proofInlineTypes.has(artifact.contentType) || Object.values(version.resources ?? {}).includes(artifact.id))) throw proofNotFound();
    const size = artifact?.size ?? version.size;
    let range: ByteRange | undefined;
    try {
        range = readRange(request.headers.get('range'), size);
    } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 416) throw error;
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    const headers = {
        'Content-Type': artifact?.contentType === 'text/html' ? 'text/plain; charset=utf-8' : artifact?.contentType ?? 'application/octet-stream',
        'Content-Disposition': original ? attachment(version.filename) : 'inline',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'self'; sandbox",
        'Accept-Ranges': 'bytes',
        'Content-Length': String(range?.length ?? size),
        ...(range ? { 'Content-Range': `bytes ${range.offset}-${range.offset + range.length - 1}/${size}` } : {})
    };
    const prefix = proofAttemptPrefix(version, version.publishedAttemptId);
    const body = request.method === 'HEAD' ? null
        : await getProofBlobs().open(`${prefix}${original ? 'original' : `media/${artifactId}`}`, range, request.signal);
    return new Response(body, { status: range ? 206 : 200, headers });
}

function subresource(parts: string[], segment: string, length: number) {
    return parts.length === length && parts[0] === segment;
}
const json = async <TSchema extends z.ZodType>(request: Request, schema: TSchema) => parseJsonBody(request, schema, 12 * 1024);
const noContent = () => new Response(null, { status: 204 });

async function handleProof(request: Request, projectId: string, path: string[], baseUrl: () => Promise<string>) {
    const { method } = request;
    const url = new URL(request.url);
    if (!path.length && method === 'GET') {
        const collection = url.searchParams.get('collection');
        return Response.json(await listProofLibrary(request, projectId, collection === null ? undefined : validId(collection)));
    }
    if (subresource(path, 'assets', 1) && method === 'POST')
        return Response.json({ asset: await saveProofAsset(request, projectId, undefined, await json(request, assetInput)) }, { status: 201 });
    if (subresource(path, 'assets', 2)) {
        const assetId = validId(path[1]!);
        if (method === 'GET') {
            const version = url.searchParams.get('version');
            return Response.json(await getProofAsset(request, { projectId, assetId, versionId: version === null ? undefined : validId(version) }));
        }
        if (method === 'PATCH')
            return Response.json({ asset: await saveProofAsset(request, projectId, assetId, await json(request, assetInput.partial())) });
        if (method === 'DELETE') {
            await deleteProofAsset(request, projectId, assetId);
            return noContent();
        }
    }
    if (path.length === 2 && path[0] === 'figma' && path[1] === 'frames' && method === 'POST')
        return Response.json(await inspectProofFigma(request, projectId, await json(request, figmaFramesInput)));
    if (path.length === 3 && path[0] === 'assets' && path[2] === 'figma' && method === 'POST')
        return Response.json({ version: await importProofFigma(request, projectId, validId(path[1]!), await json(request, figmaImportInput)) });
    if (path.length === 3 && path[0] === 'assets' && path[2] === 'email-address') {
        const assetId = validId(path[1]!);
        if (method === 'GET') return Response.json(await proofEmailAddress(request, projectId, assetId));
        if (method === 'POST' || method === 'DELETE')
            return Response.json(await proofEmailAddress(request, projectId, assetId, method === 'POST' ? 'rotate' : 'disable'));
    }
    if (path[0] === 'assets' && path[2] === 'uploads') {
        const assetId = validId(path[1]!);
        if (path.length === 3 && method === 'POST') {
            const input = await json(request, proofUploadInput);
            if (input.contentType === figmaSourceType) throw apiErrors.invalidRequest('Use the authorized Figma import for design snapshots.');
            if (input.size > MAX_PROOF_UPLOAD_BYTES) throw apiErrors.tooLarge(MAX_PROOF_UPLOAD_BYTES);
            return Response.json(await beginProofUpload(request, projectId, assetId, input));
        }
        if (path.length === 5 && path[4] === 'bytes' && method === 'PUT') {
            await putLocalProofUpload(request, projectId, assetId, validId(path[3]!));
            return noContent();
        }
        if (path.length === 5 && path[4] === 'finalize' && method === 'POST')
            return Response.json({ version: await finalizeProofUpload(request, projectId, assetId, validId(path[3]!)) });
    }
    if (path[0] === 'assets' && path[2] === 'versions' && (method === 'GET' || method === 'HEAD')) {
        const assetId = validId(path[1]!);
        const versionId = validId(path[3] ?? '');
        if (path.length === 5 && path[4] === 'prototype' && method === 'GET')
            return Response.json(await openPrototype(request, projectId, assetId, versionId, await baseUrl()));
        if (path.length === 5 && path[4] === 'original') return proofMedia(request, projectId, assetId, versionId);
        if (path.length === 6 && path[4] === 'media' && proofArtifactIdPattern.test(path[5]!))
            return proofMedia(request, projectId, assetId, versionId, path[5]!);
    }
    if (subresource(path, 'collections', 1) && method === 'POST')
        return Response.json({ collection: await saveProofCollection(request, projectId, undefined, await json(request, collectionInput)) }, { status: 201 });
    if (subresource(path, 'collections', 2)) {
        const collectionId = validId(path[1]!);
        if (method === 'PATCH')
            return Response.json({ collection: await saveProofCollection(request, projectId, collectionId, await json(request, collectionInput.partial())) });
        if (method === 'DELETE') {
            await deleteProofCollection(request, projectId, collectionId);
            return noContent();
        }
    }
    if (subresource(path, 'shares', 1)) {
        if (method === 'GET') return Response.json({ shares: await listProofShares(request, projectId) });
        if (method === 'POST') {
            const base = await baseUrl();
            const { share, path: viewerPath } = await createProofShare(request, projectId, await json(request, shareInput));
            return Response.json({ share, url: new URL(viewerPath, base).href }, { status: 201 });
        }
    }
    if (subresource(path, 'shares', 2) && method === 'DELETE' && (idPattern.test(path[1]!) || digestId.test(path[1]!))) {
        await revokeProofShare(request, projectId, path[1]!);
        return noContent();
    }
    if (subresource(path, 'exchange', 1) && method === 'POST') {
        const { token } = await json(request, exchangeInput);
        const { scope, cookies } = await exchangeProofShare(request, projectId, token);
        const response = Response.json({ scope });
        for (const value of cookies) response.headers.append('Set-Cookie', value);
        return response;
    }
    if (subresource(path, 'settings', 1)) {
        if (method === 'GET') {
            const { actor } = await authorizeProof(request, { projectId }, 'manage');
            return Response.json({ formats: await proofFormatSettings(request, projectId),
                canEdit: actor.kind === 'member' && actor.isAdmin, htmlAvailable: Boolean(proofPreviewOrigin()) });
        }
        if (method === 'PATCH') {
            const { formats } = await json(request, settingsInput);
            return Response.json({ formats: await proofFormatSettings(request, projectId, [...new Set(formats)]) });
        }
    }
    throw proofNotFound();
}

export type ProofRouteContext = { params: Promise<{ projectId: string; proofPath?: string[] }> };

export async function proofApi(request: Request, { params }: ProofRouteContext, baseUrl: () => Promise<string>) {
    let response: Response;
    try {
        const site = request.headers.get('sec-fetch-site');
        if (site && site !== 'same-origin' && site !== 'none') throw apiErrors.forbidden('Cross-site requests are not allowed.');
        if (request.method !== 'GET' && request.method !== 'HEAD') assertAppOrigin(request);
        const { projectId, proofPath = [] } = await params;
        response = await handleProof(request, projectId, proofPath, baseUrl);
    } catch (error) {
        // Storage SDK errors may include authorization headers or a signed URI.
        if (!(error instanceof ApiError)) console.error('[proofs] Proof request failed');
        response = errorResponse(error instanceof ApiError ? error : new ApiError(500, 'server_error', 'The proof request failed. Please try again.'));
    }
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return response;
}
