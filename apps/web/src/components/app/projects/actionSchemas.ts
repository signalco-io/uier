import { z } from 'zod';
import { MAX_PROJECT_NAME_LENGTH } from '../../../lib/app/limits';
import { projectIdSchema, workspaceIdSchema } from '../../../lib/app/validation';

export const projectStatusActionSchema = z.object({ projectId: projectIdSchema, status: z.enum(['active', 'done']) });
/** The typed project name; the service compares it with the stored name. */
export const deleteProjectActionSchema = z.object({ projectId: projectIdSchema, confirmation: z.string().max(MAX_PROJECT_NAME_LENGTH * 2) });
/** The workspace to move the project to and the typed project name; the service checks both again. */
export const transferProjectActionSchema = deleteProjectActionSchema.extend({ workspaceId: workspaceIdSchema });
/** A person's own emails from a project: `muted` stops all of them, also those of threads they follow. */
export const projectEmailsActionSchema = z.object({ projectId: projectIdSchema, muted: z.boolean() });
/** A project of the header whose popover is opening (its people, its client's projects); the action loads it again. */
export const projectHeaderActionSchema = z.object({ projectId: projectIdSchema });
