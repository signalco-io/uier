import { assertNotBot } from '@/src/lib/comments/botProtection';
import { apiErrors, commentsApiHandler, parseJsonBody } from '@/src/lib/comments/http';
import { changeFixVerification } from '@/src/lib/review/fixVerification';
import { fixVerificationSchema } from '@/src/lib/review/fixVerificationSchema';
import { commentResponse } from '@/src/lib/review/response';
import { isValidId } from '@/src/lib/comments/validation';

export const POST = commentsApiHandler<{ id: string }>(async (context, { id }) => {
    await assertNotBot();
    if (!context.project || !context.actor || !isValidId(id)) throw apiErrors.notFound();
    const input = await parseJsonBody(context.request, fixVerificationSchema);
    return commentResponse({ request: context.request, project: context.project, actor: context.actor, siteOrigin: context.origin },
        await changeFixVerification(context.project, context.actor, id, input));
});
