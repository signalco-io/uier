import { z } from 'zod';
import { isRandomToken } from '../../app/tokens';

/** Positional arguments of the OAuth server actions (outside the 'use server' module) */
export const authorizationRequestActionSchema = z.object({ requestId: z.string().refine(isRandomToken) });
export const connectedAppActionSchema = z.object({ grantId: z.string().regex(/^grant_[A-Za-z0-9_-]{1,64}$/) });
