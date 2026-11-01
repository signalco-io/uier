import { clearDraftScopes } from '@uier/toolbar/drafts';

/** App drafts stay local to this deployment's browser origin. */
export function clearAppReplyDrafts() {
    clearDraftScopes([location.origin, 'app']);
}
