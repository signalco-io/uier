import { isDeepStrictEqual } from 'node:util';
import type { DbComment } from '../db/schema';
import type { DbProject } from '../app/model';
import { apiErrors } from '../comments/http';
import { authorizeProof, liveProofShare, scopeIncludesAsset, type ProofAuthorization, type ProofTarget } from './access';
import { proofEpoch, proofNotFound, proofStore } from './store';
import { assertProofAnchor } from './threadSchema';
import type { ProjectActor } from '../review/actor';
import type { ProofVerificationEvidence } from './threadModel';

export type ProofThreadRoute = Required<Pick<ProofTarget, 'projectId' | 'assetId'>>;

export async function authorizeProofThread(request: Request, route: ProofThreadRoute, versionId?: string, write = false) {
    const target = { ...route, versionId };
    const auth = await authorizeProof(request, target, write ? 'comment' : 'view');
    const actor: ProjectActor = scopedActor(auth);
    return { ...auth, actor, permissions: auth.actor };
    function scopedActor({ actor, asset }: ProofAuthorization): ProjectActor {
        if (!asset || asset.id !== route.assetId) throw proofNotFound();
        const shareId = actor.kind === 'guest' ? actor.shareId : undefined;
        return { ...actor, proofThread: { assetId: asset.id, shareId, async refresh(write) {
            const fresh = await authorizeProof(request, target, write ? 'comment' : 'view');
            if (fresh.project.id !== auth.project.id || fresh.project.workspaceId !== auth.project.workspaceId
                || fresh.actor.kind !== auth.actor.kind
                || (fresh.actor.kind === 'member' && auth.actor.kind === 'member' && fresh.actor.userId !== auth.actor.userId)
                || (fresh.actor.kind === 'guest' && (fresh.actor.visitorId !== (auth.actor.kind === 'guest' && auth.actor.visitorId) || fresh.actor.shareId !== shareId)))
                throw proofNotFound();
            return { project: fresh.project, actor: scopedActor(fresh) };
        } } };
    }
}

/** Persisted share reference is server-only. A general visitor ID or a revoked grant cannot confer authority. */
export async function guestCanReviewProof(project: DbProject, comment: DbComment) {
    const target = comment.assetTarget;
    if (!target?.authorShareId) return false;
    const store = proofStore(project.id);
    const [asset, grant, guard] = await Promise.all([store.asset(target.assetId), store.share(target.authorShareId), store.guard()]);
    return Boolean(asset?.doc.currentVersionId && !asset.doc.deleted && !guard?.doc.deleted
        && liveProofShare(grant?.doc, project, proofEpoch(guard?.doc)) && grant.doc.permission === 'comment'
        && scopeIncludesAsset(grant.doc.scope, asset.doc));
}

export async function liveProofThreadAsset(project: DbProject, assetId: string) {
    const store = proofStore(project.id);
    const [guard, asset] = await Promise.all([store.guard(), store.asset(assetId)]);
    return !guard?.doc.deleted && asset?.doc.currentVersionId && !asset.doc.deleted ? asset.doc : null;
}

/** Called inside the authoritative verification transition, after the thread and actor were refreshed. */
export async function assertFileVerificationRequest(project: DbProject, comment: DbComment, evidence?: ProofVerificationEvidence) {
    const target = comment.assetTarget;
    if (!target || !evidence || evidence.assetId !== target.assetId || !isDeepStrictEqual(target.source, evidence.before)
        || evidence.after.versionId === target.source.versionId)
        throw apiErrors.invalidRequest('Choose a location on a different version of this file.');
    const store = proofStore(project.id);
    const [before, after] = await Promise.all([store.version(evidence.before.versionId), store.version(evidence.after.versionId)]);
    if (!before || before.doc.assetId !== target.assetId || before.doc.status !== 'published'
        || !after || after.doc.assetId !== target.assetId || after.doc.status !== 'published')
        throw proofNotFound();
    if (before.doc.number === null || after.doc.number === null || after.doc.number <= before.doc.number)
        throw apiErrors.invalidRequest('Choose a version published after the original.');
    assertProofAnchor(evidence.before.anchor, before.doc.manifest);
    assertProofAnchor(evidence.after.anchor, after.doc.manifest);
}
