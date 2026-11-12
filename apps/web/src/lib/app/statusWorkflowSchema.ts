import { z } from 'zod';
import { statusCategories } from './statusWorkflow';
export const workflowStatusIdSchema = z.string().min(1).max(80).regex(/^[a-z][a-z0-9_-]*$/);
const plainText = (max: number) => z.string().trim().max(max).refine(text => !/[\p{Cc}\p{Cf}]/u.test(text), 'Use plain text without control characters.');
export const statusWorkflowSchema = z.object({
    statuses: z.array(z.object({ id: workflowStatusIdSchema, category: z.enum(statusCategories), label: plainText(40).min(1), description: plainText(500) }).strict()).min(5).max(30),
    initialStatusId: workflowStatusIdSchema, doneStatusId: workflowStatusIdSchema, archiveStatusId: workflowStatusIdSchema
}).strict().superRefine((workflow, ctx) => {
    const error = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (new Set(workflow.statuses.map(status => status.id)).size !== workflow.statuses.length) error('Each status needs a unique ID.');
    if (new Set(workflow.statuses.map(status => status.label.toLowerCase())).size !== workflow.statuses.length) error('Give each status a different name.');
    for (const category of statusCategories) {
        if (!workflow.statuses.some(status => status.category === category)) error('Keep at least one status in every category.');
        if (workflow.statuses.some(status => status.id === category && status.category !== category)) error('Standard status IDs must keep their category.');
    }
    for (const [field, category] of [['doneStatusId', 'done'], ['archiveStatusId', 'archive']] as const)
        if (!workflow.statuses.some(status => status.id === workflow[field] && status.category === category)) error(`Choose a ${category} status for the action.`);
    const initial = workflow.statuses.find(status => status.id === workflow.initialStatusId);
    if (!initial || !['open', 'in-progress'].includes(initial.category)) error('New comments must start in Open or In progress.');
});
export const projectStatusWorkflowSchema = z.object({ mode: z.literal('replace'), value: statusWorkflowSchema }).strict();
