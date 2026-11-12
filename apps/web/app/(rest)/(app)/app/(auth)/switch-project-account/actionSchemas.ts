import { z } from 'zod';

export const switchProjectAccountSchema = z.object({
    next: z.string().max(2048),
    userId: z.string().min(1).max(100),
    workspaceId: z.string().min(1).max(100)
});
