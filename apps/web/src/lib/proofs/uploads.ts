import { createHash, randomUUID } from 'node:crypto';
import type { DbProject } from '../app/model';
import { memberActor } from '../review/actor';
import { sha256Hex, signToken, verifyToken } from '../app/tokens';
import { ApiError, apiErrors } from '../comments/http';
import { authorizeProof, proofProject } from './access';
import { proofVersion } from './assets';
import { getProofBlobs, proofAttemptPrefix, proofStagedBlob, type ProofBlobs } from './blobs';
import { MAX_PROOF_UPLOAD_BYTES, proofApiPath, type ProofUploadGrant, type ProofUploadInput } from './model';
import { getProofSourceAdapter, ingestProofBytes, ProofSourceError } from './sources';
import { mutateProof, proofConflict, proofEpoch, proofNotFound, proofStore, type DbProofProject, type DbProofVersion, type ProofStore } from './store';

const grantMs = 10 * 60_000;
const uploadMs = 24 * 60 * 60_000;
const processingMs = 2 * 60_000;
export const proofBlobGraceMs = 15 * 60_000;
const pendingLimit = 24;
const localUploadPurpose = 'proof-local-upload';
type LocalUpload = { projectId: string; assetId: string; versionId: string; uploaderId: string };
const iso = (ms: number) => new Date(ms).toISOString();

export const proofCleanupAt = (version: Pick<DbProofVersion, 'grantUntil' | 'attempt'>, now = Date.now()) =>
    iso(Math.max(Date.parse(version.grantUntil), Date.parse(version.attempt?.until ?? version.grantUntil), now) + proofBlobGraceMs);

function unsupported() {
    return new ApiError(415, 'unsupported_media_type', 'This file format is not enabled for proof uploads.');
}

function staleVersion() {
    return proofConflict('A newer version was published. Start an upload against the latest version.');
}

function failedVersion(version: DbProofVersion) {
    if (version.failureKind === 'conflict') return proofConflict(version.failure);
    return new ProofSourceError(version.failure ?? 'The upload could not be processed.');
}

export function failProofVersion(version: DbProofVersion, failure: string, failureKind: 'conflict' | 'input' = 'conflict'): DbProofVersion {
    const { attempt: _, ...rest } = version;
    return { ...rest, status: 'failed', failure, failureKind, nextAttemptAt: proofCleanupAt(version) };
}

function checkUploadInput(input: ProofUploadInput) {
    if (!Number.isSafeInteger(input.size) || input.size < 1) throw apiErrors.invalidRequest('Choose a nonempty file.');
    if (input.size > MAX_PROOF_UPLOAD_BYTES) throw apiErrors.tooLarge(MAX_PROOF_UPLOAD_BYTES);
}

export async function beginProofUpload(request: Request, projectId: string, assetId: string, input: ProofUploadInput): Promise<ProofUploadGrant> {
    checkUploadInput(input);
    const { project, actor } = await authorizeProof(request, { projectId, assetId }, 'manage');
    if (actor.kind !== 'member') throw proofNotFound();
    const { version, repeated } = await mutateProof(project, async (proofs, guard) => {
        const { project: current, actor: owner, asset } = await authorizeProof(request, { projectId, assetId }, 'manage');
        if (owner.kind !== 'member' || owner.userId !== actor.userId || !asset) throw proofNotFound();
        const epoch = proofEpoch(guard);
        const id = sha256Hex(JSON.stringify([project.id, current.workspaceId, epoch, assetId, owner.userId, input.requestId])).slice(0, 32);
        const previous = await proofs.version(id);
        const now = Date.now();
        if (previous) {
            const saved = previous.doc;
            if (saved.filename !== input.filename || saved.contentType !== input.contentType
                || saved.expectedVersionId !== input.expectedVersionId || saved.size !== input.size)
                throw proofConflict('That upload request ID was already used with different file details.');
            if (saved.status !== 'pending') return { value: { version: saved, repeated: true } };
            if (saved.uploadUntil <= iso(now)) throw proofConflict('This upload expired. Start a new upload.');
        }
        if (!getProofSourceAdapter(input.contentType, guard.formats ?? ['image'])) throw unsupported();
        if (asset.currentVersionId !== input.expectedVersionId) throw staleVersion();
        if (previous && previous.doc.grantUntil > iso(now + 30_000)) return { value: { version: previous.doc, repeated: true } };
        const uploadUntil = previous?.doc.uploadUntil ?? iso(now + uploadMs);
        const grantUntil = iso(Math.min(Date.parse(uploadUntil), now + grantMs));
        if (previous) {
            const doc = { ...previous.doc, grantUntil };
            return { value: { version: doc, repeated: true }, operations: [{ kind: 'replace', doc, etag: previous.etag }] };
        }
        const counts = await Promise.all(['pending', 'processing'].map(status =>
            proofs.store.count<DbProofVersion>({ type: 'proof-version', pk: proofs.pk, where: { status, epoch } })));
        if (counts.reduce((total, count) => total + count, 0) >= pendingLimit)
            throw apiErrors.unavailable('This project has too many unfinished file uploads.');
        const doc: DbProofVersion = {
            type: 'proof-version', id, pk: proofs.pk, ttl: -1, projectId: project.id, workspaceId: current.workspaceId, epoch,
            assetId, uploaderId: owner.userId, expectedVersionId: input.expectedVersionId,
            filename: input.filename, contentType: input.contentType, size: input.size,
            number: null, status: 'pending', createdAt: iso(now), artifacts: [], uploadUntil, grantUntil, nextAttemptAt: uploadUntil
        };
        return { value: { version: doc, repeated: false }, operations: [{ kind: 'create', doc }] };
    });
    const representation = proofVersion(projectId, version, actor);
    if (version.status !== 'pending') return { version: representation, uploadUrl: null, headers: {}, expiresAt: version.grantUntil };
    const blobs = getProofBlobs();
    if (repeated && await blobs.hasStaged(proofStagedBlob(version)))
        return { version: representation, uploadUrl: null, headers: {}, expiresAt: version.grantUntil };
    const grant = blobs.uploadGrant
        ? await blobs.uploadGrant(proofStagedBlob(version), version.contentType, new Date(version.grantUntil))
        : { uploadUrl: `${proofApiPath(projectId)}/assets/${assetId}/uploads/${version.id}/bytes?token=${signToken<LocalUpload>(localUploadPurpose,
            { projectId: project.id, assetId, versionId: version.id, uploaderId: version.uploaderId },
            Math.max(1, Math.floor((Date.parse(version.grantUntil) - Date.now()) / 1000)))}`,
        headers: { 'Content-Type': version.contentType } };
    return { version: representation, expiresAt: version.grantUntil, ...grant };
}

function assertUploadOwner(version: DbProofVersion, assetId: string, userId: string, project: DbProject, guard: DbProofProject) {
    if (version.assetId !== assetId || version.uploaderId !== userId || version.workspaceId !== project.workspaceId
        || version.epoch !== proofEpoch(guard)) throw proofNotFound();
}

/** Trusted imports and local development can stage raw source bytes through the same private slot. */
export async function stageProofSource(request: Request, projectId: string, assetId: string, versionId: string, bytes: Buffer) {
    const { project, actor } = await authorizeProof(request, { projectId, assetId }, 'manage');
    if (actor.kind !== 'member') throw proofNotFound();
    const version = await mutateProof(project, async (proofs, guard) => {
        const { project: current, actor: owner } = await authorizeProof(request, { projectId, assetId }, 'manage');
        if (owner.kind !== 'member') throw proofNotFound();
        const saved = (await proofs.version(versionId))?.doc;
        if (!saved) throw proofNotFound();
        assertUploadOwner(saved, assetId, owner.userId, current, guard);
        if (saved.status !== 'pending' || saved.grantUntil <= iso(Date.now())) throw proofConflict('This upload grant is no longer active.');
        if (bytes.length !== saved.size) throw apiErrors.invalidRequest('The uploaded file size does not match the grant.');
        return { value: saved };
    });
    await putStagedBytes(getProofBlobs(), version, bytes);
}

async function putStagedBytes(blobs: ProofBlobs, version: DbProofVersion, bytes: Buffer) {
    try {
        await blobs.put(proofStagedBlob(version), bytes, version.contentType, AbortSignal.timeout(30_000));
    } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'conflict'
            || !(await blobs.readStaged(proofStagedBlob(version), version.size))?.equals(bytes)) throw error;
    }
}

/** Simulates the direct Azure capability locally, including create-only and credential-free PUT. */
export async function putLocalProofUpload(request: Request, projectId: string, assetId: string, versionId: string) {
    const project = await proofProject(projectId);
    const token = verifyToken<LocalUpload>(localUploadPurpose, new URL(request.url).searchParams.get('token'));
    if (!token || token.projectId !== project.id || token.assetId !== assetId || token.versionId !== versionId) throw proofNotFound();
    const blobs = getProofBlobs();
    if (blobs.uploadGrant) throw proofNotFound();
    const proofs = proofStore(project.id);
    const { uploaderId } = token;
    async function liveVersion() {
        const current = await proofProject(projectId);
        const [version, asset, guard, member] = await Promise.all([
            proofs.version(versionId), proofs.asset(assetId), proofs.guard(), memberActor(current, uploaderId)
        ]);
        if (!version || !asset || asset.doc.deleted || !guard || guard.doc.deleted || member?.kind !== 'member') throw proofNotFound();
        assertUploadOwner(version.doc, assetId, uploaderId, current, guard.doc);
        if (version.doc.status !== 'pending' || version.doc.grantUntil <= iso(Date.now())) throw proofConflict('This upload grant is no longer active.');
        return version.doc;
    }
    const version = await liveVersion();
    if (request.headers.get('content-type')?.toLowerCase() !== version.contentType) throw unsupported();
    if (Number(request.headers.get('content-length')) > version.size) throw apiErrors.tooLarge(version.size);
    const reader = request.body?.getReader();
    if (!reader) throw apiErrors.invalidRequest('Choose a nonempty file.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > version.size) {
            await reader.cancel().catch(() => undefined);
            throw apiErrors.tooLarge(version.size);
        }
        chunks.push(value);
    }
    if (size !== version.size) throw apiErrors.invalidRequest('The uploaded file size does not match the grant.');
    await putStagedBytes(blobs, await liveVersion(), Buffer.concat(chunks, size));
}

type Processing = {
    project: DbProject;
    assetId: string;
    versionId: string;
    userId: string;
    /** The request path supplies live session checks. A scheduled retry checks the saved member. */
    reauthorize?: () => Promise<DbProject>;
    blobs: ProofBlobs;
    store?: ProofStore['store'];
};

async function currentProject(input: Processing, proofs: ProofStore) {
    if (input.reauthorize) return input.reauthorize();
    const project = await proofProject(input.project.id, proofs.store);
    if ((await memberActor(project, input.userId))?.kind !== 'member') throw proofNotFound();
    return project;
}

async function saveProcessingFailure(input: Processing, attemptId: string, failure?: ProofSourceError) {
    return mutateProof(input.project, async (proofs, guard) => {
        const project = await currentProject(input, proofs);
        const saved = await proofs.version(input.versionId);
        if (!saved || saved.doc.attempt?.id !== attemptId) return { value: undefined };
        assertUploadOwner(saved.doc, input.assetId, input.userId, project, guard);
        const { attempt: _, ...rest } = saved.doc;
        const doc: DbProofVersion = failure ? failProofVersion(saved.doc, failure.message, 'input')
            : { ...rest, status: 'pending', nextAttemptAt: saved.doc.uploadUntil };
        return { value: undefined, operations: [{ kind: 'replace', doc, etag: saved.etag }] };
    }, input.store);
}

/** Claims a renewable job by ETag and publishes an immutable run and the asset pointer in one batch. */
export async function processProofUpload(input: Processing): Promise<DbProofVersion> {
    const attemptId = randomUUID();
    const claimed = await mutateProof<{ version: DbProofVersion; done: boolean }>(input.project, async (proofs, guard) => {
        const project = await currentProject(input, proofs);
        const [asset, saved] = await Promise.all([proofs.asset(input.assetId), proofs.version(input.versionId)]);
        if (!asset || asset.doc.deleted || !saved) throw proofNotFound();
        const version = saved.doc;
        assertUploadOwner(version, input.assetId, input.userId, project, guard);
        if (version.status === 'published' || version.status === 'failed') return { value: { version, done: true } };
        const now = iso(Date.now());
        if (version.attempt && version.attempt.until > now) throw proofConflict('This file is already being processed. Try again shortly.');
        const failure = version.uploadUntil <= now ? 'This upload expired. Start a new upload.'
            : asset.doc.currentVersionId !== version.expectedVersionId ? staleVersion().message : undefined;
        if (failure) {
            const doc = failProofVersion(version, failure);
            return { value: { version: doc, done: true }, operations: [{ kind: 'replace', doc, etag: saved.etag }] };
        }
        if (!getProofSourceAdapter(version.contentType, guard.formats ?? ['image'])) throw unsupported();
        const until = iso(Date.now() + processingMs);
        const doc: DbProofVersion = { ...version, status: 'processing', attempt: { id: attemptId, until }, nextAttemptAt: until };
        return { value: { version: doc, done: false }, operations: [{ kind: 'replace', doc, etag: saved.etag }] };
    }, input.store);
    if (claimed.done) {
        if (claimed.version.status === 'failed') throw failedVersion(claimed.version);
        return claimed.version;
    }

    const version = claimed.version;
    const signal = AbortSignal.timeout(90_000);
    const prefix = proofAttemptPrefix(version, attemptId);
    let result: Awaited<ReturnType<typeof ingestProofBytes>>;
    let digest: string;
    try {
        const blob = await input.blobs.readStaged(proofStagedBlob(version), version.size, signal);
        if (!blob) {
            await saveProcessingFailure(input, attemptId);
            throw proofConflict('Upload the file before publishing this version.');
        }
        // Re-read live format policy before work. The publish transaction checks it again.
        const policy = (await proofStore(version.projectId, input.store).guard())?.doc.formats ?? ['image'];
        const adapter = getProofSourceAdapter(version.contentType, policy);
        if (!adapter) throw unsupported();
        result = await ingestProofBytes(adapter, { bytes: blob, filename: version.filename, contentType: version.contentType, signal });
        digest = createHash('sha256').update(blob).digest('hex');
        await input.blobs.put(`${prefix}original`, blob, version.contentType, signal);
        for (const artifact of result.artifacts)
            await input.blobs.put(`${prefix}media/${artifact.id}`, artifact.bytes, artifact.contentType, signal);
    } catch (error) {
        if (error instanceof ProofSourceError || (error instanceof ApiError && error.code === 'invalid_request')) {
            const failure = new ProofSourceError(error.message);
            await saveProcessingFailure(input, attemptId, failure);
            throw failure;
        }
        throw error;
    }

    const savedVersion = await mutateProof(input.project, async (proofs, guard) => {
        const project = await currentProject(input, proofs);
        const [asset, saved] = await Promise.all([proofs.asset(input.assetId), proofs.version(input.versionId)]);
        if (!asset || asset.doc.deleted || !saved) throw proofNotFound();
        assertUploadOwner(saved.doc, input.assetId, input.userId, project, guard);
        if (saved.doc.status === 'published') return { value: saved.doc };
        if (saved.doc.attempt?.id !== attemptId || saved.doc.attempt.until <= iso(Date.now())) throw proofConflict();
        if (asset.doc.currentVersionId !== saved.doc.expectedVersionId
            || !getProofSourceAdapter(version.contentType, guard.formats ?? ['image'])) {
            const doc = failProofVersion(saved.doc, asset.doc.currentVersionId !== saved.doc.expectedVersionId
                ? staleVersion().message : unsupported().message);
            return { value: doc, operations: [{ kind: 'replace', doc, etag: saved.etag }] };
        }
        const preceding = asset.doc.currentVersionId ? await proofs.version(asset.doc.currentVersionId) : null;
        if (asset.doc.currentVersionId && preceding?.doc.status !== 'published')
            throw new Error('The current file version is missing.');
        const now = iso(Date.now());
        const { attempt: _, ...rest } = saved.doc;
        const doc: DbProofVersion = { ...rest, status: 'published', number: (preceding?.doc.number ?? 0) + 1,
            digest, manifest: result.manifest, artifacts: result.artifacts.map(({ id, contentType, bytes }) => ({ id, contentType, size: bytes.length })),
            publishedAt: now, publishedAttemptId: attemptId, nextAttemptAt: proofCleanupAt(saved.doc) };
        return { value: doc, operations: [
            { kind: 'replace', doc, etag: saved.etag },
            { kind: 'replace', doc: { ...asset.doc, updatedAt: now, currentVersionId: doc.id }, etag: asset.etag }
        ] };
    }, input.store);
    if (savedVersion.status === 'failed') throw failedVersion(savedVersion);
    return savedVersion;
}

export async function finalizeProofUpload(request: Request, projectId: string, assetId: string, versionId: string) {
    const initial = await authorizeProof(request, { projectId, assetId }, 'manage');
    if (initial.actor.kind !== 'member') throw proofNotFound();
    const userId = initial.actor.userId;
    const version = await processProofUpload({ project: initial.project, assetId, versionId, userId, blobs: getProofBlobs(),
        reauthorize: async () => {
            const fresh = await authorizeProof(request, { projectId, assetId }, 'manage');
            if (fresh.actor.kind !== 'member' || fresh.actor.userId !== userId) throw proofNotFound();
            return fresh.project;
        }
    });
    const fresh = await authorizeProof(request, { projectId, assetId, versionId }, 'manage');
    return proofVersion(projectId, version, fresh.actor);
}
