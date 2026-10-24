import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { ApiError } from '../comments/http';
import { EmailNotConfiguredError } from '../email/send';
import { AccessDeniedError } from './context';

/** Result of a server action used with `useActionState` (`null` before the first submit) */
export type ActionState<T = void> =
    | { ok: true; data: T; message?: string }
    | { ok: false; error: string }
    | null;

/** A message for the person, without internals */
export class UserFacingError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UserFacingError';
    }
}

export function firstIssueMessage(error: z.ZodError) {
    return error.issues[0]?.message ?? 'Check the form and try again.';
}

/**
 * Runs a server action body and turns expected failures into `{ ok: false, error }`. Next.js
 * redirects and not-found errors pass through.
 */
export async function actionResult<T>(body: () => Promise<T>, message?: string): Promise<ActionState<T>> {
    try {
        return { ok: true, data: await body(), message };
    } catch (error) {
        unstable_rethrow(error);
        if (error instanceof UserFacingError || error instanceof AccessDeniedError)
            return { ok: false, error: error.message };
        if (error instanceof z.ZodError)
            return { ok: false, error: firstIssueMessage(error) };
        if (error instanceof ApiError && error.code === 'rate_limited')
            return { ok: false, error: error.message };
        if (error instanceof EmailNotConfiguredError) {
            console.error('[app]', error);
            return { ok: false, error: 'Email can\'t be sent right now. Try again later.' };
        }
        console.error('[app] Action failed', error);
        return { ok: false, error: 'Something went wrong. Try again.' };
    }
}
