import { randomUUID } from 'node:crypto';
import { apiErrors } from '../comments/http';
import { randomToken, sha256Hex } from '../app/tokens';
import { authorizeProof, proofAllowsGuest, proofPermissions, scopeIncludesAsset, type ProofTarget } from './access';
import {
    proofApiPath, proofCollectionPath, proofViewerPath,
    type ProofActor, type ProofAsset, type ProofAssetDetail, type ProofCollection, type ProofFormat, type ProofLibrary,
    type ProofShare, type ProofShareScope, type ProofVersion
} from './model';
import {
    mutateProof, proofConflict, proofEpoch, proofNotFound, proofStore, type DbProofAsset, type DbProofCollection,
    type DbProofShare, type DbProofVersion
} from './store';

type AssetInput = { name?: string; collectionId?: string | null; position?: number };
type CollectionInput = { name?: string; position?: number };
type ShareInput = { scope: ProofShareScope; permission: ProofShare['permission']; downloadOriginal?: boolean; expiresAt?: string | null };

export function proofAsset({ id, name, collectionId, position, currentVersionId, createdAt, updatedAt }: DbProofAsset): ProofAsset {
    return { id, name, collectionId, position, currentVersionId, createdAt, updatedAt };
}
function proofCollection({ id, name, position, createdAt }: DbProofCollection): ProofCollection {
    return { id, name, position, createdAt };
}
function proofShare({ id, scope, permission, downloadOriginal, createdAt, expiresAt, revokedAt }: DbProofShare): ProofShare {
    return { id, scope, permission, downloadOriginal, createdAt, expiresAt, revokedAt };
}

export function proofVersion(projectId: string, version: DbProofVersion, actor: Pick<ProofActor, 'downloadOriginal' | 'manage'>): ProofVersion {
    const { assetId, id, number, status, filename, contentType, size, digest, manifest, createdAt, publishedAt, failure } = version;
    const path = `${proofApiPath(projectId)}/assets/${assetId}/versions/${id}`;
    const certifiedPdf = manifest?.format !== 'pdf' || manifest.pdf?.rendition === 'raster-ocr-v1';
    return {
        id, assetId, number, status, filename, contentType, size, digest, createdAt, publishedAt, failure,
        manifest: manifest?.format === 'figma' && !actor.manage
            ? { format: 'figma', surfaces: manifest.surfaces.map(({ sourceUrl: _, ...surface }) => surface) }
            : manifest,
        artifacts: version.artifacts.filter(artifact => certifiedPdf && !Object.values(version.resources ?? {}).includes(artifact.id))
            .map(artifact => ({ ...artifact, url: `${path}/media/${artifact.id}` })),
        ...(status === 'published' && actor.downloadOriginal ? { originalUrl: `${path}/original` } : {})
    };
}

const ordered = <T extends { id: string; position: number; createdAt: string }>(a: T, b: T) =>
    a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

export async function listProofLibrary(request: Request, projectId: string, collectionId?: string): Promise<ProofLibrary> {
    const { project, actor } = await authorizeProof(request, { projectId });
    const proofs = proofStore(project.id);
    const { scope } = actor;
    if (collectionId && (scope.kind === 'asset' || (scope.kind === 'collection' && collectionId !== scope.id)))
        throw proofNotFound();
    const scopedCollection = scope.kind === 'collection' ? scope.id : collectionId;
    const [assets, collections] = await Promise.all([
        scope.kind === 'asset' ? proofs.asset(scope.id).then(row => row ? [row.doc] : []) : proofs.assets(scopedCollection),
        scopedCollection ? proofs.collection(scopedCollection).then(row => row ? [row.doc] : [])
            : scope.kind === 'project' ? proofs.collections() : []
    ]);
    if (scopedCollection && !collections.length) throw proofNotFound();
    return {
        assets: assets.filter(asset => !asset.deleted && scopeIncludesAsset(scope, asset)
            && (actor.kind === 'member' || asset.currentVersionId !== null))
            .sort(ordered).map(proofAsset),
        collections: collections.sort(ordered).map(proofCollection),
        permissions: proofPermissions(actor)
    };
}

export async function getProofAsset(request: Request, target: Required<Pick<ProofTarget, 'projectId' | 'assetId'>> & Pick<ProofTarget, 'versionId'>): Promise<ProofAssetDetail> {
    const { project, actor, asset, version } = await authorizeProof(request, target);
    if (!asset) throw proofNotFound();
    const versions = await proofStore(project.id).versions(asset.id);
    const visible = versions.filter(item => item.status === 'published' || (actor.kind === 'member'
        && item.workspaceId === project.workspaceId && item.uploaderId === actor.userId));
    visible.sort((a, b) => (b.number ?? 0) - (a.number ?? 0) || b.createdAt.localeCompare(a.createdAt));
    return {
        asset: proofAsset(asset),
        version: version ? proofVersion(target.projectId, version, actor) : null,
        versions: visible.map(item => proofVersion(target.projectId, item, actor)),
        permissions: proofPermissions(actor),
        ...(actor.kind === 'guest' && actor.returning ? { returning: true } : {})
    };
}

export async function saveProofAsset(request: Request, projectId: string, assetId: string | undefined, input: AssetInput) {
    const { project } = await authorizeProof(request, { projectId, assetId }, 'manage');
    const id = assetId ?? randomUUID();
    return mutateProof(project, async proofs => {
        await authorizeProof(request, { projectId, assetId }, 'manage');
        const saved = assetId ? await proofs.asset(assetId) : null;
        if (assetId && (!saved || saved.doc.deleted)) throw proofNotFound();
        const collectionId = input.collectionId === undefined ? saved?.doc.collectionId ?? null : input.collectionId;
        if (collectionId && !await proofs.collection(collectionId)) throw proofNotFound();
        const now = new Date().toISOString();
        const doc: DbProofAsset = {
            ...saved?.doc, type: 'proof-asset', pk: proofs.pk, id, ttl: -1, name: input.name ?? saved?.doc.name ?? '',
            collectionId, position: input.position ?? saved?.doc.position ?? 0,
            createdAt: saved?.doc.createdAt ?? now, updatedAt: now, currentVersionId: saved?.doc.currentVersionId ?? null
        };
        return { value: proofAsset(doc), operations: [saved ? { kind: 'replace', doc, etag: saved.etag } : { kind: 'create', doc }] };
    });
}

export async function deleteProofAsset(request: Request, projectId: string, assetId: string) {
    const { project } = await authorizeProof(request, { projectId }, 'manage');
    return mutateProof(project, async proofs => {
        await authorizeProof(request, { projectId }, 'manage');
        const saved = await proofs.asset(assetId);
        if (!saved || saved.doc.deleted) return { value: undefined };
        const doc = { ...saved.doc, deleted: true, nextAttemptAt: new Date().toISOString() };
        return { value: undefined, operations: [{ kind: 'replace', doc, etag: saved.etag }] };
    });
}

export async function saveProofCollection(request: Request, projectId: string, collectionId: string | undefined, input: CollectionInput) {
    const { project } = await authorizeProof(request, { projectId }, 'manage');
    const id = collectionId ?? randomUUID();
    return mutateProof(project, async proofs => {
        await authorizeProof(request, { projectId }, 'manage');
        const saved = collectionId ? await proofs.collection(collectionId) : null;
        if (collectionId && !saved) throw proofNotFound();
        const doc: DbProofCollection = { type: 'proof-collection', pk: proofs.pk, id, ttl: -1, name: input.name ?? saved?.doc.name ?? '',
            position: input.position ?? saved?.doc.position ?? 0, createdAt: saved?.doc.createdAt ?? new Date().toISOString() };
        return { value: proofCollection(doc), operations: [saved ? { kind: 'replace', doc, etag: saved.etag } : { kind: 'create', doc }] };
    });
}

export async function deleteProofCollection(request: Request, projectId: string, collectionId: string) {
    const { project } = await authorizeProof(request, { projectId }, 'manage');
    return mutateProof(project, async proofs => {
        await authorizeProof(request, { projectId }, 'manage');
        const saved = await proofs.collection(collectionId);
        if (!saved) return { value: undefined };
        const assets = await proofs.store.query<DbProofAsset>({ type: 'proof-asset', pk: proofs.pk, where: { collectionId } });
        if (assets.some(asset => !asset.deleted)) throw proofConflict('Move the files out of this collection before deleting it.');
        return { value: undefined, operations: [{ kind: 'delete', pk: proofs.pk, id: collectionId, etag: saved.etag }] };
    });
}

export async function listProofShares(request: Request, projectId: string) {
    const { project } = await authorizeProof(request, { projectId }, 'manage');
    const proofs = proofStore(project.id);
    const epoch = proofEpoch((await proofs.guard())?.doc);
    const shares = await proofs.shares({ epoch });
    return shares.filter(share => share.workspaceId === project.workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(proofShare);
}

export async function createProofShare(request: Request, projectId: string, input: ShareInput) {
    const { project } = await authorizeProof(request, { projectId }, 'manage');
    const token = randomToken();
    const id = randomUUID();
    const tokenHash = sha256Hex(token);
    return mutateProof(project, async (proofs, guard) => {
        const { project: current } = await authorizeProof(request, { projectId }, 'manage');
        if (!proofAllowsGuest(current)) throw apiErrors.forbidden('Guest review links are turned off for this project.');
        if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) throw apiErrors.invalidRequest('Choose a future expiry.');
        const scope = input.scope;
        if (scope.kind === 'asset') {
            const asset = (await proofs.asset(scope.id))?.doc;
            if (!asset?.currentVersionId || asset.deleted) throw proofNotFound();
        } else if (!await proofs.collection(scope.id)) throw proofNotFound();
        const doc: DbProofShare = {
            type: 'proof-share', pk: proofs.pk, id, ttl: -1, tokenHash, scope, permission: input.permission,
            downloadOriginal: input.downloadOriginal ?? false, workspaceId: current.workspaceId, epoch: proofEpoch(guard),
            createdAt: new Date().toISOString(), expiresAt: input.expiresAt ?? null, revokedAt: null,
            ...(scope.kind === 'asset' ? { assetId: scope.id } : { collectionId: scope.id })
        };
        const publicId = current.publicId ?? projectId;
        const path = scope.kind === 'asset' ? proofViewerPath(publicId, scope.id) : proofCollectionPath(publicId, scope.id);
        return { value: { share: proofShare(doc), path: `${path}#share=${token}` }, operations: [{ kind: 'create', doc }] };
    });
}

export async function revokeProofShare(request: Request, projectId: string, shareId: string) {
    const { project } = await authorizeProof(request, { projectId }, 'manage');
    return mutateProof(project, async (proofs, guard) => {
        const { project: current } = await authorizeProof(request, { projectId }, 'manage');
        const saved = await proofs.share(shareId);
        if (!saved || saved.doc.revokedAt || saved.doc.workspaceId !== current.workspaceId || saved.doc.epoch !== proofEpoch(guard))
            return { value: undefined };
        const doc = { ...saved.doc, revokedAt: new Date().toISOString() };
        return { value: undefined, operations: [{ kind: 'replace', doc, etag: saved.etag }] };
    });
}

export async function proofFormatSettings(request: Request, projectId: string, formats?: ProofFormat[]): Promise<ProofFormat[]> {
    const { project, actor } = await authorizeProof(request, { projectId }, 'manage');
    if (formats === undefined) return (await proofStore(project.id).guard())?.doc.formats ?? ['image'];
    if (actor.kind !== 'member' || !actor.isAdmin) throw apiErrors.forbidden('Only workspace admins can change proof formats.');
    return mutateProof(project, async (_, guard) => {
        const { actor: current } = await authorizeProof(request, { projectId }, 'manage');
        if (current.kind !== 'member' || !current.isAdmin) throw apiErrors.forbidden('Only workspace admins can change proof formats.');
        return { value: formats, guard: { ...guard, formats } };
    });
}
