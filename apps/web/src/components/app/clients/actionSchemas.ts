import { z } from 'zod';
import { clientIdSchema } from '../../../lib/app/clients';

export const clientActionSchema = z.object({ clientId: clientIdSchema });
