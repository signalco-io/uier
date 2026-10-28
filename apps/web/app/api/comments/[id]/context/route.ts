import { appBaseUrl } from '@/src/lib/app/request';
import { feedbackExport } from '@/src/lib/comments/feedbackContext';
import { apiErrors, commentsApiHandler } from '@/src/lib/comments/http';
import { toPublicCommentDto } from '@/src/lib/comments/service';
import { isValidId } from '@/src/lib/comments/validation';
import { PUBLIC_PROJECT_ID, PUBLIC_PROJECT_PARTITION } from '@/src/lib/comments/publicProject';
import { getCommentsStore } from '@/src/lib/repo/commentsStore';

export const GET = commentsApiHandler<{ id: string }>(async (context, { id }) => {
    if (!isValidId(id)) throw apiErrors.notFound();
    const store = getCommentsStore();
    const stored = await store.get(context.domain, id);
    if (!stored) throw apiErrors.notFound();
    const dto = await toPublicCommentDto(stored.comment, context);
    const base = await appBaseUrl();
    const page = new URL(dto.path, base);
    const link = new URL(page);
    link.searchParams.set('review', 'true');
    link.searchParams.set('uier-comment', dto.id);
    const screenshot = dto.screenshot ? await store.getScreenshot(context.domain, id) : null;
    return Response.json(feedbackExport(dto, {
        projectId: context.domain === PUBLIC_PROJECT_PARTITION ? PUBLIC_PROJECT_ID : undefined,
        pageUrl: page.href, commentUrl: link.href,
        screenshotUrl: screenshot ? new URL(`/api/comments/${encodeURIComponent(id)}/screenshot`, base).href : undefined }));
});
