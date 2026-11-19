import { apiErrors } from '../../comments/http';
import { getUser } from '../../app/users';
import { memberActor } from '../../review/actor';
import { eligibleParticipants } from '../../review/participants';
import { authorizeProof, proofProject, scopeIncludesAsset, liveProofShare, type ProofAuthorization, type ProofTarget } from '../access';
import { listProofLibrary } from '../assets';
import { sha256Hex } from '../../app/tokens';
import { mutateProof, proofConflict, proofEpoch, proofNotFound, proofStore, type ProofStore } from '../store';
import { approvalCookies, approvalReviewerFor, externalReviewerId, memberReviewerId, readApprovalLink } from './identity';
import type { ApprovalReview, ApprovalState, ApprovalSummary } from './model';
import type { ConfigureInput, ReviewerInput, StartInput, SubmitInput } from './schema';
import { approvalIso, approvalMail, approvalMailOperations, approvalSummary, readRound, roundId, type ApprovalEvent,
    type ApprovalExchange, type ApprovalRound, type StoredReviewer } from './storage';

type AssetTarget = Required<Pick<ProofTarget, 'projectId' | 'assetId'>>;
type ReadyProof = ProofAuthorization & { asset: NonNullable<ProofAuthorization['asset']>; version: NonNullable<ProofAuthorization['version']> };

async function approvalTarget(request: Request, route: AssetTarget, versionId?: string, manage = false): Promise<ReadyProof> {
    const auth = await authorizeProof(request, { ...route, versionId }, manage ? 'manage' : 'view');
    if (!auth.asset || !auth.version || (auth.actor.kind === 'guest' && auth.actor.returning)) throw proofNotFound();
    return { ...auth, asset: auth.asset, version: auth.version };
}

const changedRound = () => proofConflict('The approval round changed. Review the latest state and try again.');
const changedVersion = () => proofConflict('A newer version is available. Open it to record a decision.');
const decisionDenied = () => apiErrors.forbidden('Only the assigned reviewer can decide.');

function validateDeadline(deadline: string | null, previous?: string | null) {
    const normalized = deadline ? approvalIso(Date.parse(deadline)) : null;
    if (normalized && normalized !== previous && Date.parse(normalized) <= Date.now())
        throw apiErrors.invalidRequest('Choose a future approval deadline.');
    return normalized;
}

function makeEvent(proofs: ProofStore, auth: ReadyProof, actor: string, epoch: string, input: StartInput | ConfigureInput | SubmitInput, action: ApprovalEvent['action']): ApprovalEvent {
    return { id: 'approval-event:' + sha256Hex(JSON.stringify([auth.asset.id, auth.version.id, epoch, actor, input.requestId])),
        pk: proofs.pk, type: 'proof-approval-event', assetId: auth.asset.id, versionId: auth.version.id, actor,
        fingerprint: sha256Hex(JSON.stringify([action, input])), action, at: approvalIso(Date.now()) };
}

async function repeatedEvent(proofs: ProofStore, event: ApprovalEvent) {
    const existing = (await proofs.store.get<ApprovalEvent>(proofs.pk, event.id))?.doc;
    if (!existing) return false;
    if (existing.fingerprint !== event.fingerprint) throw proofConflict('That approval request ID was already used.');
    return true;
}

export async function readApprovalReview(request: Request, route: AssetTarget, versionId?: string): Promise<ApprovalReview> {
    const auth = await approvalTarget(request, route, versionId);
    const proofs = proofStore(auth.project.id);
    const [guard, record] = await Promise.all([proofs.guard(), readRound(proofs, auth.version.id)]);
    const currentVersionId = auth.asset.currentVersionId!;
    const canManage = auth.actor.manage && currentVersionId === auth.version.id && (!record || record.doc.epoch === proofEpoch(guard?.doc));
    if (!record) return { round: null, currentVersionId, canManage, canRequestLink: false };
    const { doc: round } = record;
    const summary = approvalSummary(round, currentVersionId, proofEpoch(guard?.doc));
    const events = await proofs.store.query<ApprovalEvent>({ type: 'proof-approval-event', pk: proofs.pk, where: { versionId: round.versionId } });
    const reviewerId = !guard?.doc.deleted && summary.state === 'open' ? approvalReviewerFor(request, auth.project, auth.actor, round)?.id : undefined;
    const shareId = auth.actor.kind === 'guest' ? auth.actor.shareId : null;
    const canRequestLink = summary.state === 'open' && !reviewerId && Boolean(shareId) &&
        round.reviewers.some(reviewer => reviewer.kind === 'external' && reviewer.shareId === shareId);
    // Explicitly omit mailbox addresses, share IDs and account IDs from review and export.
    const reviewers = round.reviewers.map(({ id, name, kind, required, decision }) => ({ id, name, kind, required, decision }));
    const history = events.flatMap(({ decision }) => decision ? [decision] : [])
        .sort((a, b) => a.at.localeCompare(b.at) || a.reviewerId.localeCompare(b.reviewerId) || a.revision - b.revision);
    return { round: { ...summary, revision: round.revision, startedAt: round.startedAt, reviewers, history },
        currentVersionId, canManage, reviewerId, canRequestLink };
}

async function eligibleRoster(proofs: ProofStore, auth: ReadyProof, inputs: ReviewerInput[], epoch: string, previous?: ApprovalRound) {
    if (!inputs.some(input => input.required)) throw apiErrors.invalidRequest('Choose at least one required reviewer.');
    const existing = new Map(previous?.reviewers.map(reviewer => [reviewer.id, reviewer]));
    const roster = await Promise.all(inputs.map(async (input): Promise<{ reviewer: StoredReviewer; email: string }> => {
        if (input.kind === 'member') {
            const [member, user] = await Promise.all([memberActor(auth.project, input.userId), getUser(input.userId)]);
            if (member?.kind !== 'member' || !user) throw apiErrors.invalidRequest('Choose a member who can access this file.');
            const id = memberReviewerId(auth.project.id, input.userId);
            return { reviewer: { ...input, id, name: member.name, decision: existing.get(id)?.decision }, email: user.email };
        }
        const id = externalReviewerId(auth.project.id, input.email);
        const share = (await proofs.share(input.shareId))?.doc;
        if (!liveProofShare(share, auth.project, epoch) || !scopeIncludesAsset(share.scope, auth.asset))
            throw apiErrors.invalidRequest('Choose a live review link for this file.');
        return { reviewer: { ...input, id, decision: existing.get(id)?.decision }, email: input.email };
    }));
    if (new Set(roster.map(({ email }) => email)).size !== roster.length) throw apiErrors.invalidRequest('Choose each reviewer once.');
    return roster.map(({ reviewer }) => reviewer);
}

export async function approvalOptions(request: Request, route: AssetTarget, versionId?: string) {
    const auth = await approvalTarget(request, route, versionId, true);
    const proofs = proofStore(auth.project.id);
    const [guard, round, members, shares] = await Promise.all([
        proofs.guard(), readRound(proofs, auth.version.id), eligibleParticipants(auth.project, auth.actor), proofs.shares()
    ]);
    const epoch = proofEpoch(guard?.doc);
    return { members, shares: shares.filter(share => liveProofShare(share, auth.project, epoch) && scopeIncludesAsset(share.scope, auth.asset))
        .map(({ id, scope, createdAt, expiresAt }) => ({ id, scope, createdAt, expiresAt })),
        assignments: round?.doc.epoch === epoch ? round.doc.reviewers.map(({ decision: _, ...reviewer }) => reviewer) : [] };
}

export async function startApproval(request: Request, route: AssetTarget, input: StartInput) {
    const first = await approvalTarget(request, route, input.versionId, true);
    await mutateProof(first.project, async (proofs, guard) => {
        const auth = await approvalTarget(request, route, input.versionId, true);
        if (auth.actor.kind !== 'member' || auth.project.id !== first.project.id) throw proofNotFound();
        const epoch = proofEpoch(guard);
        const event = makeEvent(proofs, auth, memberReviewerId(auth.project.id, auth.actor.userId), epoch, input, 'start');
        if (await repeatedEvent(proofs, event)) return { value: null };
        if (auth.asset.currentVersionId !== auth.version.id) throw changedVersion();
        if (await readRound(proofs, input.versionId)) throw changedRound();
        const deadline = validateDeadline(input.deadline);
        const reviewers = await eligibleRoster(proofs, auth, input.reviewers, epoch);
        const round: ApprovalRound = { id: roundId(input.versionId), pk: proofs.pk, type: 'proof-approval-round', projectId: auth.project.id,
            assetId: auth.asset.id, versionId: input.versionId, epoch, state: 'open', revision: 1, deadlineRevision: 1,
            deadline, startedAt: event.at, reviewers };
        return { value: null, operations: [{ kind: 'create', doc: round }, { kind: 'create', doc: event },
            ...approvalMailOperations(round, Date.parse(event.at), true, Boolean(deadline))] };
    });
    return readApprovalReview(request, route, input.versionId);
}

export async function configureApproval(request: Request, route: AssetTarget, input: ConfigureInput) {
    const first = await approvalTarget(request, route, input.versionId, true);
    await mutateProof(first.project, async (proofs, guard) => {
        const auth = await approvalTarget(request, route, input.versionId, true);
        if (auth.actor.kind !== 'member' || auth.project.id !== first.project.id) throw proofNotFound();
        const saved = await readRound(proofs, input.versionId);
        const epoch = proofEpoch(guard);
        if (!saved || saved.doc.epoch !== epoch) throw proofNotFound();
        const event = makeEvent(proofs, auth, memberReviewerId(auth.project.id, auth.actor.userId), epoch, input, 'configure');
        if (await repeatedEvent(proofs, event)) return { value: null };
        if (auth.asset.currentVersionId !== auth.version.id) throw changedVersion();
        const round = saved.doc;
        if (round.revision !== input.revision || round.state === 'closed') throw changedRound();
        const deadline = validateDeadline(input.deadline, round.deadline);
        const reviewers = input.reviewers ? await eligibleRoster(proofs, auth, input.reviewers, epoch, round) : round.reviewers;
        const reschedule = deadline !== round.deadline || Boolean(input.reviewers);
        const doc: ApprovalRound = { ...round, deadline, reviewers, state: input.state,
            revision: round.revision + 1, deadlineRevision: round.deadlineRevision + Number(reschedule) };
        const notices = input.state === 'closed' ? [] : approvalMailOperations(doc, Date.parse(event.at), false, reschedule);
        if (input.reviewers && input.state !== 'closed') {
            for (const reviewer of reviewers) {
                const previous = round.reviewers.find(item => item.id === reviewer.id);
                if (!previous || (reviewer.kind === 'external' && previous.kind === 'external' && previous.shareId !== reviewer.shareId))
                    notices.push({ kind: 'create', doc: approvalMail(doc, reviewer.id, 'invitation', Date.parse(event.at), doc.revision) });
            }
        }
        return { value: null, operations: [{ kind: 'replace', doc, etag: saved.etag }, { kind: 'create', doc: event }, ...notices] };
    });
    return readApprovalReview(request, route, input.versionId);
}

export async function submitApproval(request: Request, route: AssetTarget, input: SubmitInput) {
    if (input.decision === 'changes-requested' && !input.explanation) throw apiErrors.invalidRequest('Explain what needs to change.');
    const first = await approvalTarget(request, route, input.versionId);
    await mutateProof(first.project, async (proofs, guard) => {
        const auth = await approvalTarget(request, route, input.versionId);
        if (auth.project.id !== first.project.id) throw proofNotFound();
        const saved = await readRound(proofs, input.versionId);
        const epoch = proofEpoch(guard);
        if (!saved || saved.doc.epoch !== epoch) throw proofNotFound();
        const round = saved.doc;
        const reviewer = approvalReviewerFor(request, auth.project, auth.actor, round);
        if (!reviewer) throw decisionDenied();
        const event = makeEvent(proofs, auth, reviewer.id, epoch, input, 'decide');
        if (await repeatedEvent(proofs, event)) return { value: null };
        if (auth.asset.currentVersionId !== auth.version.id) throw changedVersion();
        if (round.revision !== input.revision || (reviewer.decision?.revision ?? 0) !== input.decisionRevision)
            throw changedRound();
        if (round.state !== 'open') throw proofConflict('This approval round is not open.');
        const decision = { reviewerId: reviewer.id, reviewerName: reviewer.name, decision: input.decision,
            ...(input.explanation ? { explanation: input.explanation } : {}), at: event.at, revision: input.decisionRevision + 1 };
        const doc: ApprovalRound = { ...round, reviewers: round.reviewers.map(item => item.id === reviewer.id ? { ...item, decision } : item) };
        return { value: null, operations: [{ kind: 'replace', doc, etag: saved.etag }, { kind: 'create', doc: { ...event, decision } }] };
    });
    return readApprovalReview(request, route, input.versionId);
}

export async function approvalDashboard(request: Request, projectId: string, collectionId?: string) {
    const { project } = await authorizeProof(request, { projectId });
    const library = await listProofLibrary(request, projectId, collectionId);
    const proofs = proofStore(project.id);
    const epoch = proofEpoch((await proofs.guard())?.doc);
    const entries = await Promise.all(library.assets.flatMap(asset => asset.currentVersionId ? [readRound(proofs, asset.currentVersionId).then(
        round => round ? [asset.id, approvalSummary(round.doc, round.doc.versionId, epoch)] as const : null
    )] : []));
    return { summaries: Object.fromEntries(entries.filter((entry): entry is readonly [string, ApprovalSummary] => Boolean(entry))) };
}

export async function requestApprovalLink(request: Request, route: AssetTarget, versionId: string, email: string) {
    const first = await approvalTarget(request, route, versionId);
    return mutateProof<{ projectId: string } | null>(first.project, async (proofs, guard) => {
        const auth = await approvalTarget(request, route, versionId);
        if (auth.actor.kind !== 'guest' || auth.asset.currentVersionId !== versionId) return { value: null };
        const round = (await readRound(proofs, versionId))?.doc;
        const shareId = auth.actor.shareId;
        if (!round || round.epoch !== proofEpoch(guard) || round.state !== 'open') return { value: null };
        const reviewer = round.reviewers.find(item => item.kind === 'external' && item.shareId === shareId && item.email === email);
        if (!reviewer) return { value: null };
        const now = Date.now();
        const doc = approvalMail(round, reviewer.id, 'recovery', now, Math.floor(now / 3_600_000));
        if (await proofs.store.get(proofs.pk, doc.id)) return { value: null };
        return { value: { projectId: auth.project.id }, operations: [{ kind: 'create', doc }] };
    });
}

export async function exchangeApprovalLink(request: Request, projectId: string, token: string) {
    const link = readApprovalLink(token);
    const first = await proofProject(projectId);
    if (first.id !== link.projectId) throw proofNotFound();
    return mutateProof(first, async (proofs, guard) => {
        const project = await proofProject(projectId);
        if (project.id !== first.id || proofEpoch(guard) !== link.epoch) throw proofNotFound();
        const round = (await readRound(proofs, link.versionId))?.doc;
        if (!round || round.epoch !== link.epoch) throw proofNotFound();
        const asset = (await proofs.asset(round.assetId))?.doc;
        const reviewer = round.reviewers.find(item => item.id === link.reviewerId && item.kind === 'external' && item.shareId === link.shareId);
        if (!asset || asset.deleted || !reviewer || !asset.currentVersionId) throw proofNotFound();
        const cookies = await approvalCookies(request, proofs, project, asset, link);
        const id = 'approval-exchange:' + sha256Hex(link.nonce);
        if (await proofs.store.get(proofs.pk, id)) throw proofNotFound();
        const doc: ApprovalExchange = { id, pk: proofs.pk, type: 'proof-approval-exchange', assetId: asset.id, epoch: link.epoch,
            ttl: Math.max(1, link.exp - Math.floor(Date.now() / 1000)) };
        return { value: { assetId: asset.id, versionId: round.versionId, cookies }, operations: [{ kind: 'create', doc }] };
    });
}
