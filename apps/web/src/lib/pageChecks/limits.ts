import { consume, type Limit } from '../comments/rateLimits';
import type { CommentsStore } from '../repo/commentsStore';
import { getCommentsStore } from '../repo/commentsStore';
import { projectPartition } from '../review/comments';

// Page check summaries are small and the toolbar sends at most one per page and change, but each is
// a write: counted per member per hour and per project per day, in the project's comment partition
// like the other review limits (small counters that expire on their own).

export const PAGE_CHECKS_PER_MEMBER_PER_HOUR = 120;
export const PAGE_CHECKS_PER_PROJECT_PER_DAY = 2000;

const message = 'Page checks are being saved too quickly. They are saved again on a later visit.';

export function memberPageChecksLimit(authorId: string): Limit {
    return { key: `member-page-checks:${authorId}`, limit: PAGE_CHECKS_PER_MEMBER_PER_HOUR, windowSeconds: 60 * 60, reason: 'too_fast', message };
}

export const projectPageChecksLimit: Limit = { key: 'project-page-checks', limit: PAGE_CHECKS_PER_PROJECT_PER_DAY, windowSeconds: 24 * 60 * 60, reason: 'too_fast', message };

/** The member's limit first: one member's burst never uses up the project's day */
export async function enforcePageCheckLimits(projectId: string, authorId: string, store: CommentsStore = getCommentsStore()) {
    const domain = projectPartition(projectId);
    await consume(store, domain, memberPageChecksLimit(authorId));
    await consume(store, domain, projectPageChecksLimit);
}
