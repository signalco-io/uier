import { z } from 'zod';

/** A project's public id (or a legacy code) from a usage link */
export const openProjectWorkspaceUsageSchema = z.object({ project: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }).strict();
