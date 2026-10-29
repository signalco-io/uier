import { z } from 'zod';
import { userIdSchema } from '../../../lib/app/validation';

export const removeMemberActionSchema = z.object({ userId: userIdSchema });
export const revokeInvitationActionSchema = z.object({ invitationId: z.string().regex(/^invitation_[A-Za-z0-9_-]{1,64}$/) });
