import { z } from 'zod';
import { workspaceIdSchema } from '../../../lib/app/validation';
import { projectSorts } from '../../../lib/app/projectOrder';

export const switchWorkspaceActionSchema = z.object({ workspaceId: workspaceIdSchema });
export const projectOrderActionSchema = z.object({ sort: z.enum(projectSorts), groupByClient: z.boolean() }).strict();
