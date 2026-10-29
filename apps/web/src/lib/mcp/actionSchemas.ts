import { z } from 'zod';

export const revokeCredentialActionSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) });
