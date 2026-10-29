import { z } from 'zod';
import { projectIdSchema } from '../../../lib/app/validation';

export const projectStatusActionSchema = z.object({ projectId: projectIdSchema, status: z.enum(['active', 'done']) });
