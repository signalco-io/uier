import { z } from 'zod';
import { projectIdSchema, userIdSchema } from '../../../lib/app/validation';
import { isValidId, textSchema } from '../../../lib/comments/validation';
import { bulkReadSchema } from '../../../lib/comments/bulkRead';

export const commentIdSchema = z.string().refine(isValidId);
export const commentActionSchema = z.object({ projectId: projectIdSchema, commentId: commentIdSchema });
export const resolveCommentActionSchema = commentActionSchema.extend({ resolved: z.boolean() });
export const privateCommentActionSchema = commentActionSchema.extend({ isPrivate: z.boolean() });
export const assignCommentActionSchema = commentActionSchema.extend({ assigneeId: userIdSchema.nullable() });
export const editCommentActionSchema = commentActionSchema.extend({ text: textSchema });
export const deleteReplyActionSchema = commentActionSchema.extend({ itemId: commentIdSchema });
export const filterAuthorActionSchema = commentActionSchema.extend({ itemId: commentIdSchema.optional() });
export const readCommentActionSchema = commentActionSchema.extend({ sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) });
export const readCommentsActionSchema = bulkReadSchema.extend({ projectId: projectIdSchema });
export const notificationActionSchema = z.object({ projectId: projectIdSchema, threadId: commentIdSchema.optional(), enabled: z.boolean() });
