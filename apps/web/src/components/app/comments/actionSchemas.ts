import { MAX_SCREENSHOT_BYTES } from '../../../lib/comments/limits';
import { priorities } from '@uier/toolbar/triage';
import { feedbackStatusTargets } from '@uier/toolbar/verification';
import { z } from 'zod';
import { projectIdSchema, userIdSchema } from '../../../lib/app/validation';
import { editThreadItemSchema, idempotencyKeySchema, isValidId, textSchema } from '../../../lib/comments/validation';
import { mentionsSchema } from '../../../lib/review/participants';
import { bulkReadSchema } from '../../../lib/comments/bulkRead';
import { assigneeIdsSchema, assignmentModeSchema, agentIdSchema } from '../../../lib/review/assignments';
import { assigneeAgentInputSchema } from '../../../lib/review/assigneeAgentModel';
import { boardSortInputSchema } from '../../../lib/app/boardSortSchema';

export const pullRequestUrlSchema = z.string().trim().min(1).max(2048);
export const commentIdSchema = z.string().refine(isValidId);
export const commentActionSchema = z.object({ projectId: projectIdSchema, commentId: commentIdSchema });
export const pullRequestCommentActionSchema = commentActionSchema.extend({ url: pullRequestUrlSchema, remove: z.boolean() });
/** Open, In progress or Done; Ready to verify is a fix check request (`verificationCommentAction`) */
export const statusCommentActionSchema = commentActionSchema.extend({ status: z.enum(feedbackStatusTargets) });
export const archiveCommentActionSchema = commentActionSchema.extend({ archived: z.boolean() });
export const privateCommentActionSchema = commentActionSchema.extend({ isPrivate: z.boolean() });
export const assignCommentActionSchema = commentActionSchema.extend({ assigneeId: userIdSchema.nullable() });
export const assignCommentsPeopleActionSchema = commentActionSchema.extend({ assigneeIds: assigneeIdsSchema, mode: assignmentModeSchema });
export const editCommentActionSchema = commentActionSchema.extend({ text: textSchema });
/** Cleaned and limited by `setProjectCommentTitle`; this only bounds the input */
export const titleCommentActionSchema = commentActionSchema.extend({ title: z.string().max(1000) });
export const replyCommentActionSchema = commentActionSchema.extend({ screenshot: z.string().max(Math.ceil(MAX_SCREENSHOT_BYTES / 3) * 4 + 64).optional(), text: textSchema, mentions: mentionsSchema.optional(), idempotencyKey: idempotencyKeySchema });
export const deleteReplyActionSchema = commentActionSchema.extend({ itemId: commentIdSchema });
/** One message's new text, the saved text it was edited from and its mentions (the review API's edit) */
export const editReplyActionSchema = deleteReplyActionSchema.extend({ ...editThreadItemSchema.shape, mentions: mentionsSchema.optional() });
export const filterAuthorActionSchema = commentActionSchema.extend({ itemId: commentIdSchema.optional() });
export const readCommentActionSchema = commentActionSchema.extend({ sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) });
export const readCommentsActionSchema = bulkReadSchema.extend({ projectId: projectIdSchema });
export const notificationActionSchema = z.object({ projectId: projectIdSchema, threadId: commentIdSchema.optional(), enabled: z.boolean() });

export const priorityCommentActionSchema = commentActionSchema.extend({ priority: z.enum(priorities), idempotencyKey: idempotencyKeySchema });
export const agentCommentActionSchema = commentActionSchema.extend({ agent: assigneeAgentInputSchema.nullable(), idempotencyKey: idempotencyKeySchema, agentId: agentIdSchema.optional(), add: z.boolean().optional() });
/** A board column's sort: the column and one of the choices it offers (`boardSortOptions`) */
export const boardSortActionSchema = z.object({ projectId: projectIdSchema }).and(boardSortInputSchema);
/** Whether the board's Archive column is expanded */
export const boardArchiveActionSchema = z.object({ projectId: projectIdSchema, expanded: z.boolean() });
