import { z } from 'zod';
import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { parseJsonBody } from '@/src/lib/comments/http';
import { threadLabelIdsSchema, threadLabelModeSchema } from '@/src/lib/app/threadLabelSchema';
import { idempotencyKeySchema } from '@/src/lib/comments/validation';
import { changeProjectCommentLabels } from '@/src/lib/review/threadLabels';
import { commentResponse } from '@/src/lib/review/response';
const schema = z.object({ labelIds: threadLabelIdsSchema, mode: threadLabelModeSchema, idempotencyKey: idempotencyKeySchema }).strict();
export const POST = reviewApiHandler<{ projectId: string; id: string }>(async (context, { id }) => {
    const input = await parseJsonBody(context.request, schema);
    return commentResponse(context, await changeProjectCommentLabels(context.project, context.actor, id, input.labelIds, input.mode, input.idempotencyKey));
});
export const OPTIONS = reviewPreflight('POST');
