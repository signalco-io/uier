import { priorities } from '@uier/toolbar/triage';
import { feedbackStatusTargets } from '@uier/toolbar/verification';
import { z } from 'zod';
import { projectIdSchema, userIdSchema } from '../../../lib/app/validation';
import { idempotencyKeySchema, isValidId, textSchema } from '../../../lib/comments/validation';
import { mentionsSchema } from '../../../lib/review/participants';
import { bulkReadSchema } from '../../../lib/comments/bulkRead';
import { assigneeAgentInputSchema } from '../../../lib/review/assigneeAgentModel';

export const commentIdSchema = z.string().refine(isValidId);
export const commentActionSchema = z.object({ projectId: projectIdSchema, commentId: commentIdSchema });
/** Open, In progress or Done; Ready to verify is a fix check request (`verificationCommentAction`) */
export const statusCommentActionSchema = commentActionSchema.extend({ status: z.enum(feedbackStatusTargets) });
export const privateCommentActionSchema = commentActionSchema.extend({ isPrivate: z.boolean() });
export const assignCommentActionSchema = commentActionSchema.extend({ assigneeId: userIdSchema.nullable() });
export const editCommentActionSchema = commentActionSchema.extend({ text: textSchema });
export const replyCommentActionSchema = commentActionSchema.extend({ text: textSchema, mentions: mentionsSchema.optional(), idempotencyKey: idempotencyKeySchema });
export const deleteReplyActionSchema = commentActionSchema.extend({ itemId: commentIdSchema });
export const filterAuthorActionSchema = commentActionSchema.extend({ itemId: commentIdSchema.optional() });
export const readCommentActionSchema = commentActionSchema.extend({ sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) });
export const readCommentsActionSchema = bulkReadSchema.extend({ projectId: projectIdSchema });
export const notificationActionSchema = z.object({ projectId: projectIdSchema, threadId: commentIdSchema.optional(), enabled: z.boolean() });

export const priorityCommentActionSchema = commentActionSchema.extend({ priority: z.enum(priorities), idempotencyKey: idempotencyKeySchema });
export const agentCommentActionSchema = commentActionSchema.extend({ agent: assigneeAgentInputSchema.nullable(), idempotencyKey: idempotencyKeySchema });
