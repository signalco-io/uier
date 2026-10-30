import { z } from 'zod';
import { MAX_PROJECT_NAME_LENGTH } from '../../../lib/app/limits';
import { projectIdSchema } from '../../../lib/app/validation';

export const projectStatusActionSchema = z.object({ projectId: projectIdSchema, status: z.enum(['active', 'done']) });
/** The typed project name; the service compares it with the stored name. */
export const deleteProjectActionSchema = z.object({ projectId: projectIdSchema, confirmation: z.string().max(MAX_PROJECT_NAME_LENGTH * 2) });
