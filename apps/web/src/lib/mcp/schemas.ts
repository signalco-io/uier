import { z } from 'zod';

// Tools and prompts must accept the same identifiers.
export const projectId = z.string().regex(/^[a-z0-9]{12}$/);
export const commentId = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
export const thread = { projectId, commentId };
