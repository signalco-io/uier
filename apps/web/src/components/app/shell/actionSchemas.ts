import { z } from 'zod';
import { workspaceIdSchema } from '../../../lib/app/validation';

export const switchWorkspaceActionSchema = z.object({ workspaceId: workspaceIdSchema });
