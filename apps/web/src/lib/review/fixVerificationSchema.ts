import { z } from 'zod';
import { idempotencyKeySchema } from '../comments/validation';
import { userIdSchema } from '../app/validation';
const base = { idempotencyKey: idempotencyKeySchema, expectedRevision: z.string().min(1).max(128).nullable() };
export const fixVerificationSchema = z.discriminatedUnion('action', [
    z.object({ ...base, action: z.literal('request'), reviewerId: z.union([z.literal('author'), userIdSchema]),
        summary: z.string().trim().max(500).optional(), fixUrl: z.string().trim().max(2048).optional() }).strict(),
    z.object({ ...base, action: z.enum(['confirm', 'reject', 'cancel']), override: z.boolean().optional() }).strict()
]);
export type FixVerificationInput = z.infer<typeof fixVerificationSchema>;
