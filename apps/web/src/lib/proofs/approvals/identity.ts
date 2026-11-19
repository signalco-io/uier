import { isLocalRuntime, keyedHash } from '../../comments/environment';
import { signToken, verifyToken } from '../../app/tokens';
import type { DbProject } from '../../app/model';
import { liveProofShare, proofGuestSessionCookies, scopeIncludesAsset } from '../access';
import type { ProofActor } from '../model';
import { proofNotFound, type DbProofAsset, type ProofStore } from '../store';
import type { ApprovalRound, StoredReviewer } from './storage';

const approvalSessionPurpose = 'proof-approval-session';
const approvalLinkPurpose = 'proof-approval-link';
const sessionSeconds = 30 * 86_400;
export const approvalLinkSeconds = 7 * 86_400;

type ApprovalLink = { projectId: string; versionId: string; reviewerId: string; shareId: string; epoch: string; nonce: string };
type ApprovalIdentity = { projectId: string; reviewerId: string; shareId: string; epoch: string; visitorId: string };

const cookieName = (projectId: string) => `${isLocalRuntime() ? '' : '__Host-'}uier-approval-${projectId}`;

export const memberReviewerId = (projectId: string, userId: string) => `member:${keyedHash('proof-reviewer-member', JSON.stringify([projectId, userId]))}`;
export const externalReviewerId = (projectId: string, email: string) => `external:${keyedHash('proof-reviewer', JSON.stringify([projectId, email]))}`;

export function approvalReviewerFor(request: Request, project: DbProject, actor: ProofActor, round: ApprovalRound) {
    if (actor.kind === 'member')
        return round.reviewers.find(reviewer => reviewer.id === memberReviewerId(project.id, actor.userId));
    const name = cookieName(project.id);
    const cookie = request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
    const identity = verifyToken<ApprovalIdentity>(approvalSessionPurpose, cookie?.slice(name.length + 1));
    if (!identity || identity.projectId !== project.id || identity.epoch !== round.epoch || identity.shareId !== actor.shareId
        || identity.visitorId !== actor.visitorId) return undefined;
    return round.reviewers.find(reviewer => reviewer.kind === 'external' && reviewer.shareId === actor.shareId && reviewer.id === identity.reviewerId);
}

export async function assignedShare(proofs: ProofStore, project: DbProject, epoch: string, asset: DbProofAsset, shareId: string, now = Date.now()) {
    const share = (await proofs.share(shareId))?.doc;
    return liveProofShare(share, project, epoch, now) && scopeIncludesAsset(share.scope, asset) ? share : null;
}

export function issueApprovalLink(round: ApprovalRound, reviewer: Extract<StoredReviewer, { kind: 'external' }>, nonce: string, seconds: number) {
    return signToken<ApprovalLink>(approvalLinkPurpose, { projectId: round.projectId, versionId: round.versionId,
        reviewerId: reviewer.id, shareId: reviewer.shareId, epoch: round.epoch, nonce }, seconds);
}

export function readApprovalLink(value: string) {
    const payload = verifyToken<ApprovalLink>(approvalLinkPurpose, value);
    if (!payload) throw proofNotFound();
    return payload;
}

export async function approvalCookies(request: Request, proofs: ProofStore, project: DbProject, asset: DbProofAsset, link: ApprovalLink) {
    const share = await assignedShare(proofs, project, link.epoch, asset, link.shareId);
    if (!share) throw proofNotFound();
    const { cookies, visitorId } = proofGuestSessionCookies(request, project, share, link.epoch);
    const age = share.expiresAt ? Math.min(sessionSeconds, Math.floor((Date.parse(share.expiresAt) - Date.now()) / 1000)) : sessionSeconds;
    if (age < 1) throw proofNotFound();
    const identity = signToken<ApprovalIdentity>(approvalSessionPurpose, {
        projectId: project.id, epoch: link.epoch, reviewerId: link.reviewerId, shareId: share.id, visitorId
    }, age);
    return [...cookies, `${cookieName(project.id)}=${identity}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${isLocalRuntime() ? '' : '; Secure'}`];
}
