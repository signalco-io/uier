import type { AppDoc, DbProject } from '../app/model';
import { getAppStore, type AppMutation, type AppStore } from '../app/store';
import { ApiError, apiErrors } from '../comments/http';
import type {
    ProofArtifact, ProofAsset, ProofCollection, ProofFormat, ProofManifest, ProofShare, ProofUploadInput, ProofVersion
} from './model';

export const proofPk = (projectId: string) => `proof:${projectId}`;
const guardId = '$proof-project';

export type DbProofProject = AppDoc & {
    type: 'proof-project';
    projectId: string;
    deleted?: boolean;
    /** A fresh epoch on transfer, including moves back to a previous workspace. */
    epoch?: string;
    formats?: ProofFormat[];
};
export type DbProofAsset = AppDoc & ProofAsset & {
    type: 'proof-asset';
    deleted?: boolean;
    nextAttemptAt?: string;
    emailIngress?: { hash: string; ownerId: string; epoch: string; createdAt: string };
};
export type DbProofCollection = AppDoc & ProofCollection & { type: 'proof-collection' };
export type DbProofShare = AppDoc & ProofShare & {
    type: 'proof-share';
    /** New grants have an independent public ID. Earlier grants used the hash as their ID. */
    tokenHash?: string;
    workspaceId: string;
    epoch: string;
    assetId?: string;
    collectionId?: string;
};
export type DbProofArtifact = Omit<ProofArtifact, 'url'>;
export type DbProofVersion = AppDoc & Omit<ProofVersion, 'artifacts' | 'originalUrl' | 'manifest'> & {
    type: 'proof-version';
    projectId: string;
    workspaceId: string;
    epoch: string;
    uploaderId: string;
    failureKind?: 'conflict' | 'input';
    expectedVersionId: ProofUploadInput['expectedVersionId'];
    uploadUntil: string;
    grantUntil: string;
    nextAttemptAt?: string;
    attempt?: { id: string; until: string };
    publishedAttemptId?: string;
    manifest?: ProofManifest;
    resources?: Record<string, string>;
    sourceFingerprint?: string;
    agentUpload?: { userId: string; connectionId: string; kind: 'credential' | 'oauth' };
    emailDeliveryKey?: string;
    emailDelivery?: { key: string; addressHash: string; sourceDigest: string };
    artifacts: DbProofArtifact[];
};

export const proofNotFound = () => apiErrors.notFound('Proof not found.');
export const proofConflict = (message = 'The proof changed while saving. Please try again.') => new ApiError(409, 'conflict', message, 1);

export function proofStore(projectId: string, store: AppStore = getAppStore()) {
    const pk = proofPk(projectId);
    async function get<T extends AppDoc>(type: T['type'], id: string) {
        const saved = await store.get<T>(pk, id);
        return saved?.doc.type === type ? saved : null;
    }
    return {
        pk,
        store,
        guard: () => get<DbProofProject>('proof-project', guardId),
        asset: (id: string) => get<DbProofAsset>('proof-asset', id),
        collection: (id: string) => get<DbProofCollection>('proof-collection', id),
        version: (id: string) => get<DbProofVersion>('proof-version', id),
        share: (id: string) => get<DbProofShare>('proof-share', id),
        async shareForToken(tokenHash: string) {
            const rows = await store.query<DbProofShare>({ type: 'proof-share', pk, where: { tokenHash }, limit: 2 });
            if (rows.length) return rows.length === 1 ? rows[0] : null;
            const original = await get<DbProofShare>('proof-share', tokenHash);
            return original && original.doc.tokenHash === undefined ? original.doc : null;
        },
        assets: (collectionId?: string) => store.query<DbProofAsset>({ type: 'proof-asset', pk,
            ...(collectionId ? { where: { collectionId } } : {}) }),
        collections: () => store.query<DbProofCollection>({ type: 'proof-collection', pk }),
        versions: (assetId: string) => store.query<DbProofVersion>({ type: 'proof-version', pk, where: { assetId } }),
        shares: (where?: Record<string, string>) => store.query<DbProofShare>({ type: 'proof-share', pk, where }),
        async ensureGuard() {
            const saved = await get<DbProofProject>('proof-project', guardId);
            if (saved) return saved;
            await store.create<DbProofProject>({ id: guardId, pk, type: 'proof-project', projectId, ttl: -1 });
            const created = await get<DbProofProject>('proof-project', guardId);
            if (!created) throw proofConflict();
            return created;
        }
    };
}

export type ProofStore = ReturnType<typeof proofStore>;
export const proofEpoch = (guard?: DbProofProject | null) => guard?.epoch ?? 'initial';

/**
 * Serializes metadata changes, including settings, collection membership and project retirement.
 * Read the guard first, then reauthorize and read any dependent records on every attempt.
 */
export async function mutateProof<T>(
    project: Pick<DbProject, 'id'>,
    change: (proofs: ProofStore, guard: DbProofProject) => Promise<{ value: T; operations?: AppMutation[]; guard?: DbProofProject }>,
    store: AppStore = getAppStore()
): Promise<T> {
    const proofs = proofStore(project.id, store);
    for (let attempt = 0; attempt < 8; attempt++) {
        const guard = await proofs.ensureGuard();
        if (guard.doc.deleted) throw proofNotFound();
        const { value, operations, guard: updated } = await change(proofs, guard.doc);
        if (!operations?.length && !updated) return value;
        if (await store.transact([{ kind: 'replace', doc: updated ?? guard.doc, etag: guard.etag }, ...operations ?? []])) return value;
    }
    throw proofConflict();
}
