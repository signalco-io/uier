import { randomUUID } from 'node:crypto';
import { configuredAppBaseUrl } from '../../app/deployment';
import { getAppStore, type AppStore } from '../../app/store';
import { getUser } from '../../app/users';
import { afterResponse } from '../../afterResponse';
import { ApiError } from '../../comments/http';
import { emailSuppression } from '../../email/suppression';
import { layoutEmail } from '../../email/templates';
import { notificationPreference } from '../../notifications/preferences';
import { deliverNotificationEmail } from '../../notifications/transport';
import { memberActor } from '../../review/actor';
import { proofProject } from '../access';
import { proofViewerPath } from '../model';
import { proofEpoch, proofStore } from '../store';
import { approvalLinkSeconds, assignedShare, issueApprovalLink } from './identity';
import { approvalIso, readRound, type ApprovalMail } from './storage';

const retryMs = 60_000;
const maxFailures = 5;
const titles: Record<ApprovalMail['purpose'], string> = {
    invitation: 'File approval requested',
    approaching: 'File approval deadline approaching',
    due: 'File approval due',
    recovery: 'Verify your file approval identity'
};

async function recipient(job: ApprovalMail, store: AppStore, now: number) {
    let project;
    try {
        project = await proofProject(job.projectId, store);
    } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
    }
    const proofs = proofStore(project.id, store);
    const [guard, asset, saved, version] = await Promise.all([
        proofs.guard(), proofs.asset(job.assetId), readRound(proofs, job.versionId), proofs.version(job.versionId)
    ]);
    const round = saved?.doc;
    if (!round || guard?.doc.deleted || round.epoch !== proofEpoch(guard?.doc) || !asset || asset.doc.deleted
        || asset.doc.currentVersionId !== round.versionId || version?.doc.status !== 'published'
        || round.state === 'closed' || (job.deadlineRevision !== undefined && job.deadlineRevision !== round.deadlineRevision)) return null;
    const reviewer = round.reviewers.find(item => item.id === job.reviewerId);
    if (!reviewer || (job.purpose !== 'recovery' && reviewer.decision)) return null;
    if (round.state === 'paused') return 'paused';
    const share = reviewer.kind === 'external' ? await assignedShare(proofs, project, round.epoch, asset.doc, reviewer.shareId, now) : null;
    if (reviewer.kind === 'external' && !share) return null;
    if (reviewer.kind === 'member' && (!await memberActor(project, reviewer.userId) || (await notificationPreference(project.id, `user:${reviewer.userId}`))?.muted))
        return null;
    const email = reviewer.kind === 'member' ? (await getUser(reviewer.userId))?.email : reviewer.email;
    if (!email || await emailSuppression(email, store)) return null;
    return { project, round, reviewer, email, share, assetName: asset.doc.name, versionNumber: version.doc.number };
}

function messageFor(context: Exclude<Awaited<ReturnType<typeof recipient>>, null | 'paused'>, purpose: ApprovalMail['purpose'],
    baseUrl: string, operationId: string, now: number) {
    const { project, round, reviewer, email, share, assetName, versionNumber } = context;
    const url = new URL(proofViewerPath(project.publicId ?? project.id, round.assetId, round.versionId), baseUrl);
    url.searchParams.set('approval', '1');
    if (reviewer.kind === 'external') {
        const seconds = share?.expiresAt ? Math.min(approvalLinkSeconds, Math.floor((Date.parse(share.expiresAt) - now) / 1_000)) : approvalLinkSeconds;
        if (seconds < 1) return;
        url.hash = new URLSearchParams({ approval: issueApprovalLink(round, reviewer, operationId, seconds) }).toString();
    }
    const deadline = round.deadline ? `Approval deadline ${new Intl.DateTimeFormat('en', {
        dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC'
    }).format(new Date(round.deadline))} UTC.` : undefined;
    return layoutEmail({ to: email, subject: titles[purpose],
        paragraphs: [`Review version ${versionNumber} of ${assetName}.`, ...(deadline ? [deadline] : [])],
        action: { label: reviewer.kind === 'external' ? 'Verify and open file' : 'Open file', url: url.href },
        footnote: reviewer.kind === 'external' ? 'The link works once and expires within seven days. If you did not expect this request, ignore this email.'
            : 'You are receiving this because you were named as a reviewer for this version.' });
}

export async function runApprovalMail(baseUrl: string, {
    store = getAppStore(), transport = deliverNotificationEmail, now = Date.now(), deadline = Date.now() + 60_000,
    projectId, versionId
}: { store?: AppStore; transport?: typeof deliverNotificationEmail; now?: number; deadline?: number; projectId?: string; versionId?: string } = {}) {
    const jobs = await store.query<ApprovalMail>({ type: 'proof-approval-mail',
        ...(projectId ? { pk: proofStore(projectId, store).pk } : {}),
        where: { active: true, ...(versionId ? { versionId } : {}) }, dueBefore: approvalIso(now), orderBy: 'nextAttemptAt', limit: 80 });
    let failed = 0;
    for (const job of jobs) {
        if (Date.now() >= deadline) break;
        if (await processApprovalMail(job, baseUrl, store, transport, now)) failed++;
    }
    return { failed };
}

async function processApprovalMail(job: ApprovalMail, baseUrl: string, store: AppStore, transport: typeof deliverNotificationEmail, now: number) {
    const saved = await store.get<ApprovalMail>(job.pk, job.id);
    if (!saved?.doc.active || saved.doc.nextAttemptAt > approvalIso(now) || (saved.doc.leaseUntil && saved.doc.leaseUntil > approvalIso(now))) return false;
    const claim = { ...saved.doc, leaseUntil: approvalIso(now + 2 * retryMs) };
    if (await store.replace(claim, saved.etag) !== 'ok') return false;
    const save = async (patch: Partial<ApprovalMail>) => {
        const current = await store.get<ApprovalMail>(job.pk, job.id);
        if (!current || current.doc.leaseUntil !== claim.leaseUntil) return false;
        return await store.replace({ ...current.doc, ...patch }, current.etag) === 'ok';
    };
    const finish = (patch: Partial<ApprovalMail>) => save({ leaseUntil: undefined, ...patch });
    const stop = () => finish({ active: false, attempt: undefined, ttl: 30 * 86_400 });
    const postpone = () => finish({ nextAttemptAt: approvalIso(now + 15 * retryMs) });
    try {
        const context = await recipient(claim, store, now);
        if (context === 'paused') { await postpone(); return false; }
        if (!context || (claim.attempt && claim.attempt.message.to !== context.email)) { await stop(); return false; }
        const operationId = randomUUID();
        const message = claim.attempt?.message ?? messageFor(context, claim.purpose, baseUrl, operationId, now);
        if (!message) { await stop(); return false; }
        const attempt = claim.attempt ?? { operationId, firstSentAt: approvalIso(now), message };
        if (!await save({ attempt })) return false;
        const latest = await recipient(claim, store, now);
        if (latest === 'paused') { await postpone(); return false; }
        if (!latest || latest.email !== attempt.message.to || latest.share?.id !== context.share?.id) { await stop(); return false; }
        const result = await transport(attempt.message, attempt, Boolean(claim.attempt));
        if (result.status === 'sent' || result.status === 'ambiguous') {
            await stop();
            if (result.status === 'ambiguous') console.error('[proof approvals] An email operation requires provider reconciliation.');
            return result.status === 'ambiguous';
        }
        if (result.status === 'pending') {
            await finish({ nextAttemptAt: approvalIso(now + retryMs) });
            return false;
        }
        const failures = claim.failures + 1;
        await finish({ attempt: undefined, failures, active: failures < maxFailures, nextAttemptAt: approvalIso(now + retryMs * 2 ** failures) });
        return true;
    } catch {
        const failures = claim.failures + 1;
        await finish({ failures, active: failures < maxFailures, nextAttemptAt: approvalIso(now + retryMs * 2 ** failures) });
        return true;
    }
}

export function deliverApprovalAfterResponse(projectId: string, versionId: string) {
    const baseUrl = configuredAppBaseUrl();
    if (!baseUrl) return;
    afterResponse(async () => {
        try {
            const result = await runApprovalMail(baseUrl, { projectId, versionId, deadline: Date.now() + 40_000 });
            if (result.failed) console.error('[proof approvals] Email delivery needs retry.');
        } catch {
            console.error('[proof approvals] Email delivery needs retry.');
        }
    });
}
