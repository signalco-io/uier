import { createDraftStore, clearDraftScopes } from '@uier/toolbar/drafts';

/** The existing reply scope also owns edits; keys keep each message separate. */
export function appCommentDrafts(projectId: string, userId: string, commentId: string) {
    return createDraftStore([typeof location === 'undefined' ? '' : location.origin, 'app', projectId, userId, commentId]);
}

/** App drafts stay local to this deployment's browser origin. */
export function clearAppReplyDrafts() {
    clearDraftScopes([location.origin, 'app']);
}
