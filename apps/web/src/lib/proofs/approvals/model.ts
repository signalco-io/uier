export const approvalReviewerLimit = 20;

export const approvalDecisions = ['approved', 'changes-requested'] as const;
export type ApprovalDecision = (typeof approvalDecisions)[number];
export type ApprovalOutcome = 'pending' | ApprovalDecision;
export type ApprovalState = 'open' | 'paused' | 'closed';

export type ApprovalEntry = {
    reviewerId: string;
    reviewerName: string;
    decision: ApprovalDecision;
    explanation?: string;
    at: string;
    revision: number;
};

export type ApprovalReviewer = {
    id: string;
    name: string;
    kind: 'member' | 'external';
    required: boolean;
    decision?: ApprovalEntry;
};

export type ApprovalSummary = {
    versionId: string;
    state: ApprovalState;
    outcome: ApprovalOutcome;
    deadline: string | null;
    overdue: boolean;
    outstanding: { name: string; required: boolean }[];
};

export type ApprovalReview = {
    round: (ApprovalSummary & {
        revision: number;
        startedAt: string;
        reviewers: ApprovalReviewer[];
        history: ApprovalEntry[];
    }) | null;
    currentVersionId: string;
    canManage: boolean;
    reviewerId?: string;
    canRequestLink: boolean;
};

export const approvalOutcomeLabels: Record<ApprovalOutcome, string> = {
    pending: 'Pending approval',
    approved: 'Approved',
    'changes-requested': 'Changes requested'
};
