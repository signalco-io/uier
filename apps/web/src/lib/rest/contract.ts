import { z } from 'zod';
import { MAX_TEXT_LENGTH } from '../comments/limits';
import { workflowStatusIdSchema } from '../app/statusWorkflowSchema';
import { statusCategories } from '../app/statusWorkflow';

export const apiRoot = '/api/v1';
export const apiPageLimit = 100;
export const apiRequestLimit = 120;
export const replyBody = z.strictObject({ text: z.string().min(1).max(MAX_TEXT_LENGTH) });
export const statusBody = z.strictObject({ statusId: workflowStatusIdSchema });
const project = z.object({ id: z.string(), name: z.string() });
const status = z.object({ id: z.string(), label: z.string(), category: z.enum(statusCategories), description: z.string() });
const summary = z.object({
    id: z.string(), path: z.string(), statusId: z.string(), createdAt: z.string().nullable(),
    excerpt: z.string().nullable()
});
const message = z.object({
    id: z.string(), createdAt: z.string().nullable(), author: z.string().nullable(),
    text: z.string().nullable(), deleted: z.boolean()
});
export const feedbackDetail = summary.extend({ messages: z.array(message) });
export const responses = {
    listProjects: z.object({ items: z.array(project) }),
    listStatuses: z.object({ items: z.array(status) }),
    listFeedback: z.object({ items: z.array(summary), next: z.string().nullable() }),
    getFeedback: feedbackDetail, reply: feedbackDetail, updateStatus: feedbackDetail
};
