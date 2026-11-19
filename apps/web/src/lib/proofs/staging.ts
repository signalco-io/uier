import { createHash } from 'node:crypto';
import { pagePath, sourcePagePath } from '@uier/toolbar/page-state';
import { z } from 'zod';
import type { AppDoc, DbProject } from '../app/model';
import { projectOrigins } from '../app/projects';
import { ApiError, apiErrors } from '../comments/http';
import { idempotencyKeySchema } from '../comments/validation';
import type { DbComment } from '../db/schema';
import { memberActor, type ProjectActor } from '../review/actor';
import { proofProject, requireProofMember } from './access';
import { approvalSummary, readRound } from './approvals/storage';
import type { StagingDesignReference, StagingPairing } from './stagingModel';
import { mutateProof, proofEpoch, proofNotFound, proofStore, type ProofStore } from './store';
import { proofReferenceId } from './threadSchema';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pairingDocId = (pairingId: string) => `staging:${pairingId}`;
export const stagingPairingId = z.string().regex(/^[a-f0-9]{64}$/);
export const stagingPairingInput = z.strictObject({
    assetId: proofReferenceId,
    versionId: proofReferenceId,
    surfaceId: z.string().min(1).max(256),
    url: z.string().trim().min(1).max(2048),
    width: z.int().min(240).max(2560),
    height: z.int().min(240).max(2560),
    requestId: idempotencyKeySchema
});

type PairingDoc = AppDoc & StagingPairing & {
    type: 'proof-staging-pairing';
    page: string;
    origin: string;
    epoch: string;
    approval: string;
    active: boolean;
    createdBy: string;
    fingerprint: string;
};

export async function availableStaging<T>(value: Promise<T>) {
    try { return await value; }
    catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
    }
}

function destination(project: DbProject, value: string) {
    let url: URL;
    try { url = new URL(value); } catch { throw proofNotFound(); }
    if (!projectOrigins(project).includes(url.origin) || url.username || url.password) throw proofNotFound();
    // Use the same state policy as comment keys. Persist only an explicitly allowed address.
    const path = url.pathname + url.search + url.hash;
    const source = sourcePagePath(path, project.pageState);
    if (new URL(source, url.origin).href !== url.href || new URL(source, url.origin).origin !== url.origin)
        throw proofNotFound();
    return { url: url.href, origin: url.origin, page: pagePath(path, project.pageState) };
}

async function approval(proofs: ProofStore, epoch: string, design: Omit<StagingDesignReference, 'pairingId'>) {
    const [asset, versionRecord, roundRecord] = await Promise.all([
        proofs.asset(design.assetId), proofs.version(design.versionId), readRound(proofs, design.versionId)
    ]);
    const version = versionRecord?.doc;
    const round = roundRecord?.doc;
    const manifest = version?.manifest;
    const surface = manifest?.surfaces.find(item => item.id === design.surfaceId);
    if (!asset || asset.doc.deleted || version?.status !== 'published' || version.assetId !== asset.doc.id
        || !version.publishedAttemptId || !surface || !surface.width || !surface.height
        || !round || round.assetId !== asset.doc.id || round.epoch !== epoch
        || (manifest?.format !== 'figma' && manifest?.format !== 'image' && manifest?.format !== 'pdf')) throw proofNotFound();
    const artifact = version.artifacts.find(item => item.id === surface.artifactId && /^image\/(?:png|jpeg|webp)$/.test(item.contentType));
    const pdf = manifest.format === 'pdf' && manifest.pdf?.rendition === 'raster-ocr-v1'
        ? version.artifacts.find(item => item.id === manifest.pdf?.artifactId && item.contentType === 'application/pdf') : undefined;
    const required = round.reviewers.filter(reviewer => reviewer.required);
    if ((!artifact && !pdf) || !required.length || approvalSummary(round, asset.doc.currentVersionId!, epoch).outcome !== 'approved')
        throw proofNotFound();
    return {
        version, surface, artifact, pdf,
        // Publishing a new version or closing a round preserves the old decision. A changed approval
        // or roster cannot silently bless an older pairing, even if the round later becomes approved again.
        signature: digest(required.map(reviewer => [reviewer.id, reviewer.decision?.revision, reviewer.decision?.at]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
    };
}

function pairingDto({ pairingId, assetId, versionId, surfaceId, url, width, height }: PairingDoc): StagingPairing {
    return { pairingId, assetId, versionId, surfaceId, url, width, height };
}

async function getPairing(proofs: ProofStore, pairingId: string) {
    const record = await proofs.store.get<PairingDoc>(proofs.pk, pairingDocId(pairingId));
    return record?.doc.type === 'proof-staging-pairing' ? record : null;
}

async function assertPairing(project: DbProject, proofs: ProofStore, pair: PairingDoc, epoch: string) {
    if (!pair.active || pair.epoch !== epoch || project.access === 'disabled') throw proofNotFound();
    const target = destination(project, pair.url);
    if (target.origin !== pair.origin || target.page !== pair.page) throw proofNotFound();
    const design = await approval(proofs, epoch, pair);
    if (design.signature !== pair.approval) throw proofNotFound();
    return { pair, ...design };
}

export async function liveStagingPair(projectId: string, pairingId: string) {
    if (!stagingPairingId.safeParse(pairingId).success) throw proofNotFound();
    const project = await proofProject(projectId);
    const proofs = proofStore(project.id);
    const [guard, record] = await Promise.all([proofs.guard(), getPairing(proofs, pairingId)]);
    if (guard?.doc.deleted || !record) throw proofNotFound();
    return { project, ...await assertPairing(project, proofs, record.doc, proofEpoch(guard?.doc)) };
}

export async function memberStagingPair(projectId: string, pairingId: string, userId: string) {
    const result = await liveStagingPair(projectId, pairingId);
    if ((await memberActor(result.project, userId))?.kind !== 'member') throw proofNotFound();
    return result;
}

export async function listStagingPairs(request: Request, projectId: string, design: Omit<StagingDesignReference, 'pairingId'>) {
    const project = await proofProject(projectId);
    const actor = await requireProofMember(request, project);
    const proofs = proofStore(project.id);
    const guard = (await proofs.guard())?.doc;
    if (guard?.deleted) throw proofNotFound();
    const epoch = proofEpoch(guard);
    const signOff = await availableStaging(approval(proofs, epoch, design));
    if (!signOff || project.access === 'disabled') return { eligible: false, sites: [], pairs: [] };
    const pairs = await proofs.store.query<PairingDoc>({ pk: proofs.pk, type: 'proof-staging-pairing',
        where: { ...design, epoch, approval: signOff.signature, active: true } });
    return { eligible: true, sites: project.urls, pairs: pairs.filter(pair => {
        try { return destination(project, pair.url).page === pair.page; } catch { return false; }
    }).map(pair => ({ ...pairingDto(pair), canRevoke: actor.isAdmin || pair.createdBy === actor.userId })) };
}

export async function createStagingPair(request: Request, projectId: string, input: z.infer<typeof stagingPairingInput>) {
    const initial = await proofProject(projectId);
    return mutateProof(initial, async (proofs, guard) => {
        const project = await proofProject(projectId);
        const actor = await requireProofMember(request, project);
        if (project.id !== initial.id || project.access === 'disabled') throw proofNotFound();
        const target = await availableStaging(Promise.resolve().then(() => destination(project, input.url)));
        if (!target) throw apiErrors.invalidRequest('Choose a project address without unapproved URL state.');
        const epoch = proofEpoch(guard);
        const signOff = await approval(proofs, epoch, input);
        const pairingId = digest([epoch, actor.userId, input.requestId]);
        const saved = await getPairing(proofs, pairingId);
        const fingerprint = digest(input);
        if (saved) {
            if (saved.doc.fingerprint !== fingerprint) throw apiErrors.conflict();
            await assertPairing(project, proofs, saved.doc, epoch);
            return { value: pairingDto(saved.doc) };
        }
        const { assetId, versionId, surfaceId, width, height } = input;
        const doc: PairingDoc = { ...target, assetId, versionId, surfaceId, width, height, pairingId, epoch, fingerprint,
            id: pairingDocId(pairingId), pk: proofs.pk, type: 'proof-staging-pairing', active: true, approval: signOff.signature, createdBy: actor.userId };
        return { value: pairingDto(doc), operations: [{ kind: 'create', doc }] };
    });
}

export async function revokeStagingPair(request: Request, projectId: string, pairingId: string) {
    const initial = await proofProject(projectId);
    await mutateProof(initial, async (proofs, guard) => {
        const project = await proofProject(projectId);
        const actor = await requireProofMember(request, project);
        const saved = await getPairing(proofs, pairingId);
        if (project.id !== initial.id || !saved || saved.doc.epoch !== proofEpoch(guard)
            || (!actor.isAdmin && saved.doc.createdBy !== actor.userId)) throw proofNotFound();
        return { value: null, ...(saved.doc.active ? { operations: [{ kind: 'replace', doc: { ...saved.doc, active: false }, etag: saved.etag }] } : {}) };
    });
}

export function stagingReference(pair: StagingDesignReference): StagingDesignReference {
    return { pairingId: pair.pairingId, assetId: pair.assetId, versionId: pair.versionId, surfaceId: pair.surfaceId };
}

export function matchesStagingThread(comment: Pick<DbComment, 'stagingDesign' | 'origin' | 'path' | 'assetTarget'>, pair: PairingDoc) {
    const reference = comment.stagingDesign;
    return !comment.assetTarget && reference?.pairingId === pair.pairingId && reference.assetId === pair.assetId
        && reference.versionId === pair.versionId && reference.surfaceId === pair.surfaceId && comment.origin === pair.origin && comment.path === pair.page;
}

export async function stagingForReview(project: DbProject, actor: ProjectActor, pairingId: string, origin: string | undefined, path: string) {
    if (actor.kind !== 'member') throw proofNotFound();
    const result = await memberStagingPair(project.id, pairingId, actor.userId);
    if (!origin || result.pair.origin !== origin || result.pair.page !== pagePath(path, result.project.pageState)) throw proofNotFound();
    return result;
}

export async function deleteStagingRecords(proofs: ProofStore, assetId?: string, isPrior?: (epoch: string) => boolean) {
    for (const type of ['proof-staging-pairing', 'proof-staging-access'] as const) {
        const records = await proofs.store.query<AppDoc & { epoch: string }>({ type, pk: proofs.pk, where: assetId ? { assetId } : undefined });
        for (const record of records) if (!isPrior || isPrior(record.epoch)) await proofs.store.delete(proofs.pk, record.id);
    }
}
