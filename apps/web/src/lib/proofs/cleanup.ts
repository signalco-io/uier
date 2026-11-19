import type { DbProject } from '../app/model';
import { getAppStore, type AppStore } from '../app/store';
import { ApiError } from '../comments/http';
import { deleteStagingRecords } from './staging';
import { retireDeletedProofThreads } from './deletedThreads';
import { proofProject } from './access';
import { deleteApprovalRecords, retireApprovalAuthority } from './approvals/storage';
import { getProofBlobs, proofAssetPrefix, proofAttemptPrefix, proofVersionPrefix, type ProofBlobs } from './blobs';
import { failProofVersion, processProofUpload, proofBlobGraceMs, proofCleanupAt } from './uploads';
import { proofEpoch, proofStore, type DbProofAsset, type DbProofVersion, type ProofStore } from './store';

function projectIdOf(pk: string) {
    return pk.slice('proof:'.length);
}

async function pruneBlobs(blobs: ProofBlobs, prefix: string, now: number, keep?: string) {
    let complete = true;
    for await (const blob of blobs.list(prefix)) {
        if (keep && blob.name.startsWith(keep)) continue;
        if (blob.updatedAt.getTime() > now - proofBlobGraceMs) {
            complete = false;
            continue;
        }
        await blobs.delete(blob.name);
    }
    return complete;
}

/** Change the proof epoch before the transferred workspace copy opens its file library. */
export async function rotateProofProject(projectId: string, epoch: string, store: AppStore) {
    const proofs = proofStore(projectId, store);
    if (!await proofs.guard()) return;
    for (let attempt = 0; attempt < 8; attempt++) {
        const guard = await proofs.guard();
        if (!guard || guard.doc.deleted || (guard.doc.epoch && guard.doc.epoch >= epoch)) return;
        if (await store.replace({ ...guard.doc, epoch }, guard.etag) === 'ok') return;
    }
    throw new Error('The proof access policy changed during project transfer.');
}

/** Remove old grants and record durable cleanup for uploads that did not publish before transfer. */
export async function cleanupTransferredProofs(projectId: string, store: AppStore) {
    const proofs = proofStore(projectId, store);
    const guard = (await proofs.guard())?.doc;
    if (!guard || guard.deleted) return;
    const epoch = proofEpoch(guard);
    const prior = (candidate: string) => candidate !== epoch && (candidate === 'initial' || candidate < epoch);
    for (const share of await proofs.shares()) if (prior(share.epoch)) await store.delete(proofs.pk, share.id);
    await retireApprovalAuthority(proofs, prior);
    await deleteStagingRecords(proofs, undefined, prior);
    const unfinished = await Promise.all(['pending', 'processing'].map(status =>
        store.query<DbProofVersion>({ type: 'proof-version', pk: proofs.pk, where: { status } })));
    for (const version of unfinished.flat()) if (prior(version.epoch)) {
        const saved = await proofs.version(version.id);
        if (saved && prior(saved.doc.epoch) && (saved.doc.status === 'pending' || saved.doc.status === 'processing')) {
            const result = await store.replace(failProofVersion(saved.doc, 'This upload was retired when the project moved.'), saved.etag);
            if (result === 'conflict') throw new Error('A proof upload changed during project transfer.');
        }
    }
}

/** Blocks new writes and fresh access before the project and its other records are removed. */
export async function retireProofProject(projectId: string, store: AppStore) {
    const proofs = proofStore(projectId, store);
    for (let attempt = 0; attempt < 8; attempt++) {
        const guard = await proofs.ensureGuard();
        if (guard.doc.deleted) return;
        const { epoch: _epoch, formats: _formats, ...tombstone } = guard.doc;
        if (await store.replace({ ...tombstone, deleted: true }, guard.etag) === 'ok') return;
    }
    throw new Error('The proof project kept changing during deletion.');
}

async function deleteAssetRecords(proofs: ProofStore, asset: DbProofAsset, now: number, blobs: () => ProofBlobs) {
    const versions = await proofs.versions(asset.id);
    const grantLive = versions.some(version => Date.parse(proofCleanupAt(version, Date.parse(version.publishedAt ?? version.createdAt))) > now
        || Date.parse(version.nextAttemptAt ?? '') > now && (version.status === 'published' || version.status === 'failed'));
    if (grantLive || (versions.length && !await pruneBlobs(blobs(), proofAssetPrefix(projectIdOf(proofs.pk), asset.id), now))) return false;
    for (const version of versions) await proofs.store.delete(proofs.pk, version.id);
    for (const share of await proofs.shares({ assetId: asset.id })) await proofs.store.delete(proofs.pk, share.id);
    await deleteApprovalRecords(proofs, asset.id);
    await deleteStagingRecords(proofs, asset.id);
    await proofs.store.delete(proofs.pk, asset.id);
    return true;
}

/** Called by the durable project deletion intent. Leave it pending while an upload grant can still write. */
export async function deleteProjectProofs(projectId: string, store: AppStore, now = Date.now(), blobs = getProofBlobs) {
    const proofs = proofStore(projectId, store);
    let complete = true;
    for (const asset of await proofs.assets()) {
        if (!await deleteAssetRecords(proofs, asset, now, blobs)) complete = false;
    }
    for (const collection of await proofs.collections()) await store.delete(proofs.pk, collection.id);
    for (const share of await proofs.shares()) await store.delete(proofs.pk, share.id);
    await deleteApprovalRecords(proofs);
    await deleteStagingRecords(proofs);
    return complete;
}

async function sweepVersion(version: DbProofVersion, proofs: ProofStore, now: number, blobs: () => ProofBlobs) {
    const guard = (await proofs.guard())?.doc;
    if (!guard || guard.deleted) return;
    const asset = (await proofs.asset(version.assetId))?.doc;
    if (!asset || asset.deleted) return;
    const saved = await proofs.version(version.id);
    if (!saved?.doc.nextAttemptAt || Date.parse(saved.doc.nextAttemptAt) > now) return;
    const active = saved.doc;
    if (active.status === 'published' || active.status === 'failed') {
        const keep = active.publishedAttemptId ? proofAttemptPrefix(active, active.publishedAttemptId) : undefined;
        if (await pruneBlobs(blobs(), proofVersionPrefix(active), now, keep)) {
            const { nextAttemptAt: _, ...doc } = active;
            await proofs.store.replace(doc, saved.etag);
        }
        return;
    }
    if (active.epoch !== proofEpoch(guard) || Date.parse(active.uploadUntil) <= now) {
        await proofs.store.replace(failProofVersion(active, 'This upload is no longer available.'), saved.etag);
        return;
    }
    if (active.status !== 'processing') return;
    let project: DbProject;
    try {
        project = await proofProject(active.projectId, proofs.store);
    } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        return; // A project being transferred or deleted has its own cleanup intent.
    }
    try {
        await processProofUpload({ project, assetId: active.assetId, versionId: active.id, userId: active.uploaderId, blobs: blobs(), store: proofs.store });
    } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if ([404, 415].includes(error.status)) {
            // Retire an abandoned slot for a removed member or a format paused before processing.
            const current = await proofs.version(active.id);
            if (current?.etag === saved.etag)
                await proofs.store.replace(failProofVersion(active, 'Access or the upload format changed before publishing.'), saved.etag);
        } else if (![409, 422].includes(error.status)) throw error;
    }
}

/** Bounded scheduled maintenance for abandoned stages, interrupted jobs and removed assets. */
export async function sweepProofStorage({ store = getAppStore(), blobs = getProofBlobs, now = Date.now(), deadline = Date.now() + 60_000 } = {}) {
    const due = new Date(now).toISOString();
    const assets = await store.query<DbProofAsset>({ type: 'proof-asset', where: { deleted: true }, dueBefore: due, orderBy: 'nextAttemptAt', limit: 50 });
    const versions = await store.query<DbProofVersion>({ type: 'proof-version', dueBefore: due, orderBy: 'nextAttemptAt', limit: 100 });
    let failed = 0;
    for (const asset of assets) {
        if (Date.now() >= deadline) return { failed };
        try {
            const proofs = proofStore(projectIdOf(asset.pk), store);
            const saved = await proofs.asset(asset.id);
            if (!saved?.doc.deleted) continue;
            const project = await proofProject(projectIdOf(asset.pk), store);
            if (!await retireDeletedProofThreads(project, asset.id) || !await deleteAssetRecords(proofs, saved.doc, now, blobs))
                await store.replace({ ...saved.doc, nextAttemptAt: new Date(now + proofBlobGraceMs).toISOString() }, saved.etag);
        } catch {
            failed++;
        }
    }
    for (const version of versions) {
        if (Date.now() >= deadline) break;
        try {
            await sweepVersion(version, proofStore(version.projectId, store), now, blobs);
        } catch {
            failed++;
        }
    }
    return { failed };
}
