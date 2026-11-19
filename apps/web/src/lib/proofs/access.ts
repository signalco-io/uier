import { projectRefPk, workspacePk, type DbProject, type DbProjectRef } from '../app/model';
import { isProjectPublicId, projectByPublicId } from '../app/projectPublicIds';
import { isProjectId } from '../app/projects';
import { requestSessionUser } from '../app/sessionIdentity';
import { getAppStore, type AppStore } from '../app/store';
import { isRandomToken, signToken, verifyToken, randomToken, sha256Hex } from '../app/tokens';
import { isLocalRuntime } from '../comments/environment';
import { apiErrors } from '../comments/http';
import { PUBLIC_WORKSPACE_ID, isUierProvisionedProject } from '../comments/publicProjectPolicy';
import { notificationPk, type NotificationSubscription } from '../notifications/subscriptions';
import { getCommentsStore } from '../repo/commentsStore';
import { memberActor } from '../review/actor';
import type { ProofActor, ProofPermissions, ProofShareScope } from './model';
import { proofEpoch, proofNotFound, proofStore, type DbProofAsset, type DbProofShare, type DbProofVersion } from './store';

const sessionLifetime = 30 * 24 * 60 * 60;
const shareSessionPurpose = 'proof-share';
const guestIdentityPurpose = 'proof-guest';
const returningPurpose = 'proof-returning-session';
const cookiePrefix = () => isLocalRuntime() ? 'uier-proof-' : '__Host-uier-proof-';
const sessionCookie = (projectId: string) => `${cookiePrefix()}${projectId}`;
const identityCookie = () => `${cookiePrefix()}visitor`;
type ShareSession = { pid: string; sid: string; epoch: string; visitor: string };
type GuestIdentity = { visitor: string };
type ReturningSession = { projectId: string; assetId: string; subscriptionId: string; version: string };
const returningCookie = (projectId: string, assetId: string) =>
    `${cookiePrefix()}returning-${sha256Hex(JSON.stringify([projectId, assetId])).slice(0, 32)}`;

export type ProofCapability = keyof ProofPermissions;
export type ProofTarget = { projectId: string; assetId?: string; versionId?: string };
export type ProofAuthorization = {
    project: DbProject;
    actor: ProofActor;
    asset: DbProofAsset | null;
    version: DbProofVersion | null;
};
type Member = Extract<ProofActor, { kind: 'member' }>;

export async function proofProject(projectId: string, store: AppStore = getAppStore()) {
    let project: DbProject | null = null;
    if (isProjectPublicId(projectId)) {
        project = await projectByPublicId(projectId, store);
    } else if (isProjectId(projectId) && !isUierProvisionedProject(projectId)) {
        const ref = (await store.get<DbProjectRef>(projectRefPk(projectId), projectId))?.doc;
        if (ref?.type === 'project-ref')
            project = (await store.get<DbProject>(workspacePk(ref.workspaceId), projectId))?.doc ?? null;
    }
    if (!project || project.type !== 'project' || project.transfer || project.workspaceId === PUBLIC_WORKSPACE_ID
        || isUierProvisionedProject(project.id)) throw proofNotFound();
    return project;
}

function cookieValue(request: Request, name: string) {
    return request.headers.get('cookie')?.split(';').map(item => item.trim()).find(item => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

function cookie(name: string, value: string, age: number) {
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${isLocalRuntime() ? '' : '; Secure'}`;
}

export const proofAllowsGuest = (project: Pick<DbProject, 'access'>) => project.access === 'guests';

export function liveProofShare(share: DbProofShare | undefined | null, project: DbProject, epoch: string, now = Date.now()): share is DbProofShare {
    return Boolean(share && !project.transfer && proofAllowsGuest(project) && share.workspaceId === project.workspaceId
        && share.epoch === epoch && !share.revokedAt && (!share.expiresAt || Date.parse(share.expiresAt) > now));
}

export async function requireProofMember(request: Request, project: DbProject): Promise<Member> {
    const user = await requestSessionUser(request);
    const actor = user ? await memberActor(project, user.id) : null;
    if (actor?.kind !== 'member') throw proofNotFound();
    return { ...actor, scope: { kind: 'project' }, view: true, comment: project.access !== 'disabled', downloadOriginal: true, manage: true };
}

export function scopeIncludesAsset(scope: ProofActor['scope'], asset: Pick<DbProofAsset, 'id' | 'collectionId'>) {
    return scope.kind === 'project' || scope.id === (scope.kind === 'asset' ? asset.id : asset.collectionId);
}

export function proofPermissions({ view, comment, downloadOriginal, manage }: ProofActor): ProofPermissions {
    return { view, comment, downloadOriginal, manage };
}

async function scopeIsLive(proofs: ReturnType<typeof proofStore>, scope: ProofShareScope, asset?: DbProofAsset | null) {
    if (scope.kind === 'collection') return Boolean(await proofs.collection(scope.id));
    const scoped = asset?.id === scope.id ? asset : (await proofs.asset(scope.id))?.doc;
    return Boolean(scoped?.currentVersionId && !scoped.deleted);
}

/** Use this for every proof target, including repeat mutations, original downloads and immutable evidence. */
export async function authorizeProof(request: Request, { projectId, assetId, versionId }: ProofTarget,
    capability: ProofCapability = 'view', returningThreads = false): Promise<ProofAuthorization> {
    const project = await proofProject(projectId);
    const proofs = proofStore(project.id);
    const guard = (await proofs.guard())?.doc;
    if (guard?.deleted) throw proofNotFound();
    const asset = assetId ? (await proofs.asset(assetId))?.doc ?? null : null;
    if ((assetId && (!asset || asset.deleted)) || (versionId && !asset)) throw proofNotFound();
    const user = await requestSessionUser(request);
    const member = user ? await memberActor(project, user.id) : null;
    let actor: ProofActor;
    if (member?.kind === 'member') {
        actor = { ...member, scope: { kind: 'project' }, view: true, comment: project.access !== 'disabled', downloadOriginal: true, manage: true };
    } else {
        const epoch = proofEpoch(guard);
        const returning = () => assetId ? returningProofActor(request, project, assetId, returningThreads) : null;
        const ordinary = await browserProofActor(request, project, proofs, epoch, asset);
        const resumed = returningThreads || (!ordinary && capability === 'view') ? await returning() : null;
        const guest = resumed && resumed.visitorId === ordinary?.visitorId && resumed.shareId === ordinary.shareId
            ? ordinary : resumed ?? ordinary;
        if (!guest) throw proofNotFound();
        actor = guest;
    }

    if (actor.kind === 'guest' && asset && !asset.currentVersionId) throw proofNotFound();
    const selected = versionId ?? asset?.currentVersionId;
    const version = selected ? (await proofs.version(selected))?.doc ?? null : null;
    if (selected && (!version || version.assetId !== asset?.id || version.status !== 'published')) throw proofNotFound();
    if (!actor[capability]) throw apiErrors.forbidden('This proof does not grant that permission.');
    return { project, actor, asset, version };
}

async function browserProofActor(request: Request, project: DbProject, proofs: ReturnType<typeof proofStore>, epoch: string, asset: DbProofAsset | null): Promise<Extract<ProofActor, { kind: 'guest' }> | null> {
    const session = verifyToken<ShareSession>(shareSessionPurpose, cookieValue(request, sessionCookie(project.id)));
    if (!session || session.pid !== project.id || session.epoch !== epoch || !isRandomToken(session.visitor) || !proofAllowsGuest(project)) return null;
    const share = (await proofs.share(session.sid))?.doc;
    if (!liveProofShare(share, project, epoch) || (asset && !scopeIncludesAsset(share.scope, asset))
        || !await scopeIsLive(proofs, share.scope, asset)) return null;
    return { kind: 'guest', visitorId: sha256Hex(session.visitor), shareId: share.id, scope: share.scope,
        view: true, comment: share.permission === 'comment', downloadOriginal: share.downloadOriginal, manage: false };
}

/** A subscription may identify only the original author under the exact live grant and asset. */
export async function liveProofFollow(project: DbProject, doc: NotificationSubscription) {
    const { proofAssetId: assetId, proofShareId: shareId, proofEpoch: epoch } = doc;
    if (doc.projectId !== project.id || doc.userId || !assetId || !shareId || !epoch) return null;
    const proofs = proofStore(project.id);
    const [guard, asset, grant, stored] = await Promise.all([
        proofs.guard(), proofs.asset(assetId), proofs.share(shareId), getCommentsStore().get(`project:${project.id}`, doc.threadId)
    ]);
    const share = grant?.doc;
    const comment = stored?.comment;
    if (guard?.doc.deleted || epoch !== proofEpoch(guard?.doc) || !liveProofShare(share, project, epoch)
        || share.permission !== 'comment' || !asset?.doc.currentVersionId || asset.doc.deleted || !scopeIncludesAsset(share.scope, asset.doc)
        || !comment?.assetTarget || comment.assetTarget.assetId !== assetId || comment.assetTarget.authorShareId !== share.id
        || comment.authorId !== doc.actorId || !comment.thread.items[0] || comment.thread.items[0].deletedAt) return null;
    if (share.scope.kind === 'collection' && !await proofs.collection(share.scope.id)) return null;
    return { share, comment, asset: asset.doc };
}

export function verifiedProofFollow(doc: NotificationSubscription) {
    return Boolean(doc.following && doc.verifiedAt && doc.email && doc.proofMailbox);
}

async function returningProofActor(request: Request, project: DbProject, assetId: string, returningThreads: boolean): Promise<Extract<ProofActor, { kind: 'guest' }> | null> {
    const session = verifyToken<ReturningSession>(returningPurpose, cookieValue(request, returningCookie(project.id, assetId)));
    if (!session || session.projectId !== project.id || session.assetId !== assetId) return null;
    const doc = (await getAppStore().get<NotificationSubscription>(notificationPk(project.id), session.subscriptionId))?.doc;
    if (doc?.type !== 'notification-subscription' || doc.version !== session.version || doc.proofAssetId !== assetId
        || !verifiedProofFollow(doc) || !await liveProofFollow(project, doc)) return null;
    return { kind: 'guest', visitorId: doc.actorId, shareId: doc.proofShareId!, scope: { kind: 'asset', id: assetId }, returning: true,
        view: true, comment: returningThreads, downloadOriginal: false, manage: false };
}

export function proofReturningCookie(doc: NotificationSubscription, share: DbProofShare) {
    const assetId = doc.proofAssetId!;
    const age = share.expiresAt ? Math.min(sessionLifetime, Math.floor((Date.parse(share.expiresAt) - Date.now()) / 1000)) : sessionLifetime;
    if (age < 1) throw proofNotFound();
    const token = signToken<ReturningSession>(returningPurpose, {
        projectId: doc.projectId, assetId, subscriptionId: doc.id, version: doc.version
    }, age);
    return cookie(returningCookie(doc.projectId, assetId), token, age);
}

/** Return no scope or cookie until the exact grant and its target have been checked. */
export async function exchangeProofShare(request: Request, projectId: string, token: string) {
    if (!isRandomToken(token)) throw proofNotFound();
    const project = await proofProject(projectId);
    if (!proofAllowsGuest(project)) throw proofNotFound();
    const proofs = proofStore(project.id);
    const guard = (await proofs.guard())?.doc;
    if (guard?.deleted) throw proofNotFound();
    const epoch = proofEpoch(guard);
    const share = await proofs.shareForToken(sha256Hex(token));
    if (!liveProofShare(share, project, epoch)) throw proofNotFound();
    if (!await scopeIsLive(proofs, share.scope)) throw proofNotFound();
    return { scope: share.scope, cookies: proofGuestSessionCookies(request, project, share, epoch).cookies };
}

/** The caller must first authorize the exact live share and its scope. */
export function proofGuestSessionCookies(request: Request, project: DbProject, share: DbProofShare, epoch: string) {
    const savedIdentity = verifyToken<GuestIdentity>(guestIdentityPurpose, cookieValue(request, identityCookie()));
    const visitor = isRandomToken(savedIdentity?.visitor) ? savedIdentity.visitor : randomToken();
    const age = share.expiresAt ? Math.min(sessionLifetime, Math.floor((Date.parse(share.expiresAt) - Date.now()) / 1000)) : sessionLifetime;
    if (age < 1) throw proofNotFound();
    const session = signToken<ShareSession>(shareSessionPurpose, { pid: project.id, sid: share.id, epoch, visitor }, age);
    return {
        visitorId: sha256Hex(visitor),
        cookies: [cookie(identityCookie(), signToken<GuestIdentity>(guestIdentityPurpose, { visitor }, 365 * 24 * 60 * 60), 365 * 24 * 60 * 60),
            cookie(sessionCookie(project.id), session, age)]
    };
}
