import type { AppDoc } from '../../app/model';
import type { AppMutation } from '../../app/store';
import { sha256Hex } from '../../app/tokens';
import type { DbProofAsset, DbProofVersion, ProofStore } from '../store';
import type { ApprovalEntry, ApprovalReviewer, ApprovalState, ApprovalSummary } from './model';

export const approvalDay = 86_400_000;
export const approvalIso = (now: number) => new Date(now).toISOString();

export type StoredReviewer = ApprovalReviewer & (
    { kind: 'member'; userId: string } |
    { kind: 'external'; email: string; shareId: string }
);

export type ApprovalRound = AppDoc & {
    type: 'proof-approval-round';
    projectId: string;
    assetId: string;
    versionId: string;
    epoch: string;
    state: ApprovalState;
    revision: number;
    deadlineRevision: number;
    deadline: string | null;
    startedAt: string;
    reviewers: StoredReviewer[];
};

export type ApprovalEvent = AppDoc & {
    type: 'proof-approval-event';
    assetId: string;
    versionId: string;
    actor: string;
    fingerprint: string;
    at: string;
    action: 'start' | 'configure' | 'decide';
    decision?: ApprovalEntry;
};

export type ApprovalMail = AppDoc & {
    type: 'proof-approval-mail';
    projectId: string;
    assetId: string;
    versionId: string;
    reviewerId: string;
    purpose: 'invitation' | 'approaching' | 'due' | 'recovery';
    deadlineRevision?: number;
    active: boolean;
    nextAttemptAt: string;
    leaseUntil?: string;
    attempt?: import('../../notifications/transport').EmailAttempt & { message: import('../../email/send').EmailMessage };
    failures: number;
};

export type ApprovalExchange = AppDoc & {
    type: 'proof-approval-exchange';
    assetId: string;
    epoch: string;
};

export const roundId = (version: string) => `approval:${version}`;

export async function readRound(proofs: ProofStore, version: string) {
    const record = await proofs.store.get<ApprovalRound>(proofs.pk, roundId(version));
    return record?.doc.type === 'proof-approval-round' ? record : null;
}

export function approvalSummary(round: ApprovalRound, currentVersion: string, epoch: string, now = Date.now()): ApprovalSummary {
    const state = round.versionId === currentVersion && round.epoch === epoch ? round.state : 'closed';
    const required = round.reviewers.filter(reviewer => reviewer.required);
    const outcome = required.some(reviewer => reviewer.decision?.decision === 'changes-requested') ? 'changes-requested'
        : required.every(reviewer => reviewer.decision?.decision === 'approved') ? 'approved' : 'pending';
    return {
        versionId: round.versionId, state, outcome, deadline: round.deadline,
        overdue: state !== 'closed' && outcome !== 'approved' && Boolean(round.deadline && Date.parse(round.deadline) <= now),
        outstanding: round.reviewers.filter(reviewer => !reviewer.decision)
            .map(({ name, required }) => ({ name, required }))
    };
}

export function approvalMail(round: ApprovalRound, reviewerId: string, purpose: ApprovalMail['purpose'], now: number, discriminator?: number): ApprovalMail {
    const id = 'approval-mail:' + sha256Hex(JSON.stringify([round.versionId, reviewerId, purpose, discriminator]));
    return {
        id, pk: round.pk, type: 'proof-approval-mail', projectId: round.projectId, assetId: round.assetId,
        versionId: round.versionId, reviewerId, purpose, active: true, nextAttemptAt: approvalIso(now), failures: 0,
        ...((purpose === 'approaching' || purpose === 'due') ? { deadlineRevision: round.deadlineRevision } : {})
    };
}

export function approvalMailOperations(round: ApprovalRound, now: number, invite: boolean, scheduleDeadline: boolean): AppMutation[] {
    const due = Date.parse(round.deadline ?? '');
    return round.reviewers.flatMap(reviewer => {
        if (reviewer.decision?.decision === 'approved') return [];
        const jobs: ApprovalMail[] = [];
        if (invite) jobs.push(approvalMail(round, reviewer.id, 'invitation', now));
        if (scheduleDeadline && due > now) {
            if (due - approvalDay > now) jobs.push(approvalMail(round, reviewer.id, 'approaching', due - approvalDay, round.deadlineRevision));
            jobs.push(approvalMail(round, reviewer.id, 'due', due, round.deadlineRevision));
        }
        return jobs.map(doc => ({ kind: 'create', doc }));
    });
}

/** Runs in the same transaction that publishes the immutable version and moves the current pointer. */
export async function rollApprovalRound(proofs: ProofStore, asset: DbProofAsset, version: DbProofVersion, epoch: string): Promise<AppMutation[]> {
    if (!asset.currentVersionId) return [];
    const previous = (await readRound(proofs, asset.currentVersionId))?.doc;
    if (!previous || previous.epoch !== epoch) return [];
    const round: ApprovalRound = {
        ...previous, id: roundId(version.id), versionId: version.id, state: previous.state === 'paused' ? 'paused' : 'open',
        revision: 1, deadlineRevision: 0, deadline: null, startedAt: version.publishedAt!,
        reviewers: previous.reviewers.map(({ decision: _, ...reviewer }) => reviewer)
    };
    return [{ kind: 'create', doc: round }, ...approvalMailOperations(round, Date.parse(round.startedAt), true, false)];
}

const approvalTypes = ['proof-approval-round', 'proof-approval-event', 'proof-approval-mail', 'proof-approval-exchange'] as const;

export async function deleteApprovalRecords(proofs: ProofStore, assetId?: string) {
    for (const type of approvalTypes) {
        for (const doc of await proofs.store.query({ pk: proofs.pk, type, where: assetId ? { assetId } : undefined }))
            await proofs.store.delete(proofs.pk, doc.id);
    }
}

export async function retireApprovalAuthority(proofs: ProofStore, isPrior: (epoch: string) => boolean) {
    const rounds = await proofs.store.query<ApprovalRound>({ pk: proofs.pk, type: 'proof-approval-round' });
    for (const round of rounds) {
        if (!isPrior(round.epoch)) continue;
        const jobs = await proofs.store.query<ApprovalMail>({ pk: proofs.pk, type: 'proof-approval-mail', where: { versionId: round.versionId } });
        for (const job of jobs) await proofs.store.delete(proofs.pk, job.id);
    }
    const exchanges = await proofs.store.query<ApprovalExchange>({ pk: proofs.pk, type: 'proof-approval-exchange' });
    for (const exchange of exchanges) if (isPrior(exchange.epoch)) await proofs.store.delete(proofs.pk, exchange.id);
}
