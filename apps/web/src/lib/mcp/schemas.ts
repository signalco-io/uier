import { z } from 'zod';

// Tools and prompts must accept the same identifiers.
export const projectId = z.string().regex(/^[a-z0-9]{12}$/)
    .describe('Owning project ID from the feedback packet or list_projects. Never infer it from the reviewed page URL. The credential must explicitly grant this project.');
export const commentId = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
export const thread = { projectId, commentId };
