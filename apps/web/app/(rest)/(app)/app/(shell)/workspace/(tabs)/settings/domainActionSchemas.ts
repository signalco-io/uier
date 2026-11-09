import { z } from 'zod';
import { emailDomainSchema } from '@/src/lib/app/workspaceDomains';

/** Positional arguments of the domain actions (bound by client components, so untrusted) */
export const domainActionSchema = z.object({ domain: emailDomainSchema });
