export type ReviewSessionView = {
    id: string;
    number?: number;
    draftId?: string;
    revision: number;
    state: 'open' | 'discarding' | 'submitted';
    pendingCount: number;
    threadCount: number;
    title?: string;
    summary?: string;
    canManage: boolean;
    canResume: boolean;
    pending?: ReviewSessionComment[];
};

export type ReviewSessionComment = { id: string; number?: number; path: string; text: string };
export type CommentReviewSession = { id: string; number?: number; revision: number; held: boolean; canResume: boolean };
export type ReviewSessionTarget = { reviewSessionId: string; reviewDraftId: string };

export const reviewSessionIsFull = (session: ReviewSessionView | undefined) => Boolean(session?.draftId && session.threadCount >= 100);
