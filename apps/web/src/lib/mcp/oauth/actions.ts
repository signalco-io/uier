'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { actionResult, UserFacingError } from '../../app/actionResult';
import { appContextOrThrow } from '../../app/context';
import { endSession } from '../../app/session';
import { parseActionInput } from '../../app/validation';
import { authorizationRequestActionSchema, connectedAppActionSchema } from './actionSchemas';
import { approveAuthorization, denyAuthorization } from './authorize';
import { OAuthError } from './errors';
import { revokeConnectedApp } from './grants';
import { oauthIssuer } from './http';

/**
 * The person allowed access on the consent page. Returns the client's callback URL instead of
 * redirecting: `form-action 'self'` blocks redirects to another origin after a form post, so the
 * page navigates there itself.
 */
export async function approveConnectionAction(requestId: string, approval: unknown) {
    return actionResult(async () => {
        const input = parseActionInput(authorizationRequestActionSchema, { requestId });
        const context = await appContextOrThrow();
        try {
            return { url: await approveAuthorization(context.user, input.requestId, approval, await oauthIssuer()) };
        } catch (error) {
            if (error instanceof OAuthError) throw new UserFacingError(error.description);
            throw error;
        }
    });
}

/** The person cancelled: the client gets `access_denied`. `url` is null when the request is gone. */
export async function cancelConnectionAction(requestId: string) {
    return actionResult(async () => {
        const input = parseActionInput(authorizationRequestActionSchema, { requestId });
        await appContextOrThrow();
        return { url: await denyAuthorization(input.requestId, await oauthIssuer()) };
    });
}

/** "Use another account": signs out and comes back to the same consent page after sign-in */
export async function switchConnectionAccountAction(requestId: string) {
    const input = parseActionInput(authorizationRequestActionSchema, { requestId });
    await endSession();
    redirect(`${KnownPages.AppSignIn}?${new URLSearchParams({ next: KnownPageLinks.mcpConnect(input.requestId) })}`);
}

/** Revokes a connected app from Account; the app loses access on its next request. */
export async function revokeConnectedAppAction(grantId: string) {
    return actionResult(async () => {
        const input = parseActionInput(connectedAppActionSchema, { grantId });
        const context = await appContextOrThrow();
        await revokeConnectedApp(context.user.id, input.grantId);
        revalidatePath(KnownPages.AppAccount);
    });
}
