import { z } from 'zod';
import { idempotencyKeySchema } from '../comments/validation';
import { userIdSchema } from '../app/validation';
const base = { idempotencyKey: idempotencyKeySchema, expectedRevision: z.string().min(1).max(128).nullable() };
export const fixVerificationSchema = z.discriminatedUnion('action', [
    z.object({ ...base, action: z.literal('request'), reviewerId: z.union([z.literal('author'), userIdSchema]),
        summary: z.string().trim().max(500).optional(), fixUrl: z.string().trim().max(2048).optional() }).strict(),
    z.object({ ...base, action: z.enum(['confirm', 'reject']), override: z.boolean().optional() }).strict(),
    // Where the thread goes: Open or In progress; without it, back to where it was before the request
    z.object({ ...base, action: z.literal('cancel'), override: z.boolean().optional(), status: z.enum(['open', 'in-progress']).optional() }).strict()
]);
export type FixVerificationInput = z.infer<typeof fixVerificationSchema>;
