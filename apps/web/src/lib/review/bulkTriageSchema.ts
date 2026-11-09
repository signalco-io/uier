import { z } from 'zod';
import { priorities } from '@uier/toolbar/triage';
import { userIdSchema } from '../app/validation';
import { idempotencyKeySchema, isValidId } from '../comments/validation';

export const MAX_TRIAGE_THREADS = 50;
const item = z.object({ id: z.string().max(128).refine(isValidId), idempotencyKey: idempotencyKeySchema }).strict();
const items = <T extends z.ZodType>(schema: T) => z.array(schema).min(1).max(MAX_TRIAGE_THREADS)
    .refine(values => new Set(values.map(value => (value as { id: string }).id)).size === values.length, 'Choose distinct threads.')
    .refine(values => new Set(values.map(value => (value as { idempotencyKey: string }).idempotencyKey)).size === values.length, 'Use distinct submission keys.');
export const bulkTriageSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('priority'), priority: z.enum(priorities), items: items(item.extend({ expected: z.enum(priorities) })) }).strict(),
    z.object({ kind: z.literal('assignment'), assigneeId: userIdSchema.nullable(), items: items(item.extend({ expected: userIdSchema.nullable(), revision: z.string().regex(/^[a-f0-9]{64}$/).optional() })) }).strict(),
    z.object({ kind: z.literal('status'), resolved: z.boolean(), items: items(item.extend({ expected: z.boolean(), revision: z.string().regex(/^[a-f0-9]{64}$/) })) }).strict()
]);
export type BulkTriageInput = z.infer<typeof bulkTriageSchema>;
export type TriageOperation = { kind: 'priority'; priority: import('@uier/toolbar/triage').CommentPriority }
    | { kind: 'assignment'; assigneeId: string | null } | { kind: 'status'; resolved: boolean };
