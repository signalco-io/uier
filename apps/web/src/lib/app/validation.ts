import { z } from 'zod';
import { UserFacingError } from './actionErrors';

/** Account ids have the same format in mentions, assignments and member actions. */
// The MCP SDK reports input validation as tool-error text, so retain the public error code there.
export const userIdSchema = z.string('invalid_request: Choose a valid user id.')
    .regex(/^u_[A-Za-z0-9_-]{1,64}$/, 'invalid_request: Choose a valid user id.');
export const projectIdSchema = z.string().regex(/^[a-z0-9]{12}$/);
export const workspaceIdSchema = z.string().regex(/^w_[A-Za-z0-9_-]{1,128}$/);

/** Positional action arguments are untrusted, including arguments bound by a client component. */
export function parseActionInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new UserFacingError('Check the request and try again.');
    return parsed.data;
}
