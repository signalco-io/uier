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
export function feedbackStatus(comment: { resolved?: boolean; verification?: { outcome: VerificationOutcome } }) {
    return comment.resolved ? 'Done' : readyForReview(comment) ? 'Ready for review' : 'Open';
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
    const label = ({ pending: 'Ready for review', 'needs-work': 'Still needs work', canceled: 'Request canceled', unconfirmed: 'Done without reviewer confirmation', reopened: 'Reopened', unavailable: 'Reviewer unavailable', confirmed: 'Done' })[v.outcome];
    return `${label}. ${requested}${decision ? ` ${decision.kind === 'confirm' ? 'Previous confirmation' : decision.kind === 'reject' ? 'Needs work decision' : 'Cancellation'} by ${attribution}${decision.kind === 'confirm' ? '; historical only' : ''}.` : ''}`;
}

/** Optimistic boolean status changes cannot display a stale current verification claim. */
export function displayedVerification(comment: { resolved?: boolean; verification?: VerificationDetails }) {
    const v = comment.verification;
    return v && comment.resolved && v.outcome === 'pending' ? { ...v, outcome: 'unconfirmed' as const }
        : v && !comment.resolved && v.outcome === 'confirmed' ? { ...v, outcome: 'reopened' as const } : v;
}
