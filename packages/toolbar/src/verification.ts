/** Public workflow projection. Actor ids and guest hashes never enter this contract. */
export type VerificationOutcome = 'pending' | 'confirmed' | 'needs-work' | 'canceled' | 'unconfirmed' | 'reopened' | 'unavailable';
export type VerificationDetails = {
    id: string; revision: string; outcome: VerificationOutcome; requestedAt: string;
    requester: string; reviewer: string; summary?: string; fixUrl?: string;
    decision?: { kind: 'confirm' | 'reject' | 'cancel'; actor: string; at: string; override: boolean };
};
export type VerificationPermissions = { selfId?: string; request: boolean; respond: boolean; cancel: boolean; override: boolean; defaultReviewer: boolean };
export function readyForReview(comment: { resolved?: boolean; verification?: { outcome: VerificationOutcome } }) {
    return !comment.resolved && comment.verification?.outcome === 'pending';
}

/**
 * Where a thread is in the workflow, the board's columns: Open, In progress, Ready to verify (a fix
 * check is pending) and Done. `resolved` stays the coarse Open/Done: In progress and Ready to verify
 * are both open. The stored `inProgress` flag is kept while a check is pending, so canceling the
 * check returns the thread to where it was; Done clears it.
 */
export type FeedbackStage = 'open' | 'in-progress' | 'ready' | 'done';
/** In the board's order */
export const feedbackStages = ['open', 'in-progress', 'ready', 'done'] as const satisfies readonly FeedbackStage[];
export const feedbackStageLabels: Record<FeedbackStage, string> = { open: 'Open', 'in-progress': 'In progress', ready: 'Ready to verify', done: 'Done' };
/** The stages a status write can set; Ready to verify is a fix check request */
export type FeedbackStatusTarget = Exclude<FeedbackStage, 'ready'>;
export const feedbackStatusTargets = ['open', 'in-progress', 'done'] as const satisfies readonly FeedbackStatusTarget[];

export function feedbackStage(comment: { resolved?: boolean; inProgress?: boolean; verification?: { outcome: VerificationOutcome } }): FeedbackStage {
    return comment.resolved ? 'done' : readyForReview(comment) ? 'ready' : comment.inProgress ? 'in-progress' : 'open';
}
export function feedbackStatus(comment: { resolved?: boolean; inProgress?: boolean; verification?: { outcome: VerificationOutcome } }) {
    return feedbackStageLabels[feedbackStage(comment)];
}
function displayTime(value: string) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }).format(date) + ' UTC' : value;
}
export function verificationDescription(v: VerificationDetails) {
    const requested = `Requested by ${v.requester} for ${v.reviewer} at ${displayTime(v.requestedAt)}.`;
    const decision = v.decision;
    const attribution = decision ? `${decision.actor} at ${displayTime(decision.at)}${decision.override ? ` (admin override for ${v.reviewer})` : ''}` : '';
    if (v.outcome === 'confirmed' && decision?.kind === 'confirm') return `Fix confirmed by ${attribution}.`;
    const label = ({ pending: 'Ready to verify', 'needs-work': 'Still needs work', canceled: 'Request canceled', unconfirmed: 'Done without reviewer confirmation', reopened: 'Reopened', unavailable: 'Reviewer unavailable', confirmed: 'Done' })[v.outcome];
    return `${label}. ${requested}${decision ? ` ${decision.kind === 'confirm' ? 'Previous confirmation' : decision.kind === 'reject' ? 'Needs work decision' : 'Cancellation'} by ${attribution}${decision.kind === 'confirm' ? '; historical only' : ''}.` : ''}`;
}

/** Optimistic boolean status changes cannot display a stale current verification claim. */
export function displayedVerification(comment: { resolved?: boolean; verification?: VerificationDetails }) {
    const v = comment.verification;
    return v && comment.resolved && v.outcome === 'pending' ? { ...v, outcome: 'unconfirmed' as const }
        : v && !comment.resolved && v.outcome === 'confirmed' ? { ...v, outcome: 'reopened' as const } : v;
}
