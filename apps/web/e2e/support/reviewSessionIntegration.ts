import { randomUUID } from 'node:crypto';
import type { DbProject } from '../../src/lib/app/model';
import { getCommentsStore } from '../../src/lib/repo/commentsStore';
import { memberActor } from '../../src/lib/review/actor';
import { createProjectComment } from '../../src/lib/review/comments';
import { reviewReleaseId } from '../../src/lib/review/reviewSessionRelease';
import { prepareReviewReleases, sendReviewSession, startReviewSession } from '../../src/lib/review/reviewSessions';
import type { DbReviewRelease } from '../../src/lib/db/schema';

export async function releaseIntegrationReview(project: DbProject, userId: string) {
    const comments = getCommentsStore();
    const actor = (await memberActor(project, userId))!;
    const draft = (await startReviewSession(project, actor, comments))!;
    const thread = await createProjectComment(new Request('http://127.0.0.1/review'), project, actor, {
        origin: 'https://reviewed.example', path: '/pricing', kind: 'feedback', position: { type: 'page' },
        text: 'Review integration child', idempotencyKey: randomUUID(), reviewSessionId: draft.id, reviewDraftId: draft.draftId!
    });
    const submitted = await sendReviewSession(project, actor, draft.id, {
        draftId: draft.draftId!, revision: draft.revision, idempotencyKey: randomUUID(), summary: 'Integration review summary'
    }, comments);
    await prepareReviewReleases(comments);
    const release = (await comments.reviewSessionRecord<DbReviewRelease>(thread.domain, reviewReleaseId(draft.id, submitted!.revision)))!.doc;
    return { thread, release };
}
