import { z } from 'zod';
import { userIdSchema } from '../app/validation';
import { authorizeSchema } from './auth';

export const extensionApprovalActionSchema = z.object({ expectedUserId: userIdSchema, authorization: authorizeSchema });
