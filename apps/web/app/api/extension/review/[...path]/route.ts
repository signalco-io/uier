import { z } from 'zod';
import { allowedExtensionOperation } from '@uier/toolbar/extension-contract';
import { extensionHandler } from '@/src/lib/extension/http';
import { extensionReviewContext } from '@/src/lib/extension/review';
import { apiErrors, parseJsonBody } from '@/src/lib/comments/http';
import { assertCanUseComments } from '@/src/lib/review/actor';
import { assertVerifiedWrite } from '@/src/lib/review/verification';
import * as review from '@/src/lib/review/routes';
import { readReviewComments, reviewActivitySummary } from '@/src/lib/review/readRoutes';
import { reattachReviewAnchor } from '@/src/lib/review/anchorRoutes';
import { projectFeedbackExport } from '@/src/lib/review/feedbackContext';
import { followThread, setProjectMuted, threadNotificationState } from '@/src/lib/notifications/preferences';
import { appBaseUrl } from '@/src/lib/app/request';

export const dynamic = 'force-dynamic';
const handler = extensionHandler(async request => {
    const url = new URL(request.url);
    const path = url.pathname.slice('/api/extension/review/'.length);
    // 'info' provides a nonempty Next catch-all segment for the root operation.
    const operation = path === 'info' ? '' : path;
    if (!allowedExtensionOperation(operation, request.method)) throw apiErrors.notFound();
    const context = await extensionReviewContext(request);
    if (operation) assertCanUseComments(context.project, context.actor);
    if (request.method !== 'GET') await assertVerifiedWrite(context);
    const { project, actor, siteOrigin } = context;
    const [, id, suffix, itemId] = path.split('/');
    if (!operation) return review.getReviewInfo(context);
    if (path === 'comments') return request.method === 'GET' ? review.listReviewComments(context) : review.createReviewComment(context);
    if (path === 'comments/activity') return reviewActivitySummary(context);
    if (path === 'comments/read') return readReviewComments(context);
    if (path === 'participants') return review.listReviewParticipants(context);
    if (path === 'rewrite') return review.suggestReviewRewrites(context);
    if (path === 'notifications') {
        const { muted } = await parseJsonBody(request, z.object({ muted: z.boolean() }));
        await setProjectMuted(project, actor, muted);
        return Response.json({ muted });
    }
    if (!id) throw apiErrors.notFound();
    if (!suffix) return request.method === 'PATCH' ? review.updateReviewComment(context, { id }) : review.deleteReviewCommentItem(context, { id });
    if (suffix === 'replies') return !itemId ? review.replyToReviewComment(context, { id })
        : request.method === 'PATCH' ? review.editReviewCommentItem(context, { id, itemId }) : review.deleteReviewCommentItem(context, { id, itemId });
    if (suffix === 'screenshot') return request.method === 'GET' ? review.getReviewScreenshot(context, { id }) : review.replaceReviewScreenshot(context, { id });
    if (suffix === 'priority') return review.prioritizeReviewComment(context, { id });
    if (suffix === 'assignee') return review.assignReviewComment(context, { id });
    if (suffix === 'anchor') return reattachReviewAnchor(context, { id });
    if (suffix === 'read') return request.method === 'POST' ? review.readReviewComment(context, { id }) : review.unreadReviewComment(context, { id });
    if (suffix === 'context') return Response.json(await projectFeedbackExport(project, actor, id, siteOrigin, await appBaseUrl()));
    if (suffix === 'notifications') {
        if (request.method === 'GET') return Response.json(await threadNotificationState(project, actor, id));
        const { following } = await parseJsonBody(request, z.object({ following: z.boolean() }));
        return Response.json(await followThread(project, actor, id, following));
    }
    throw apiErrors.notFound();
});
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
