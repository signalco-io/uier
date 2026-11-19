import { z } from 'zod';
import { userIdSchema } from '../../app/validation';
import { proofReferenceId } from '../threadSchema';
import { approvalDecisions, approvalReviewerLimit } from './model';

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const requestId = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);
const reviewer = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('member'), userId: userIdSchema, required: z.boolean() }),
    z.strictObject({ kind: z.literal('external'), name: z.string().trim().min(1).max(100).regex(/^[^\p{Cc}\p{Cf}]+$/u),
        email, shareId: z.string().regex(/^(?:[0-9a-f-]{32,36}|[0-9a-f]{64})$/), required: z.boolean() })
]);
const roster = z.array(reviewer).min(1).max(approvalReviewerLimit);
const deadline = z.iso.datetime().nullable();
const base = { versionId: proofReferenceId, requestId };
export const approvalStart = z.strictObject({ ...base, reviewers: roster, deadline });
export const approvalConfigure = z.strictObject({ ...base, revision: z.int().positive(), state: z.enum(['open', 'paused', 'closed']),
    deadline, reviewers: roster.optional() });
export const approvalSubmit = z.strictObject({ ...base, revision: z.int().positive(), decisionRevision: z.int().nonnegative(),
    decision: z.enum(approvalDecisions), explanation: z.string().trim().max(2000).optional() });
export const approvalRecovery = z.strictObject({ versionId: proofReferenceId, email });
export const approvalExchangeInput = z.strictObject({ token: z.string().min(1).max(2048) });

export type ReviewerInput = z.infer<typeof reviewer>;
export type StartInput = z.infer<typeof approvalStart>;
export type ConfigureInput = z.infer<typeof approvalConfigure>;
export type SubmitInput = z.infer<typeof approvalSubmit>;
