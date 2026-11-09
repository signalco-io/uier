'use server';

import { cookieNames, readMigratingCookie } from '@/src/lib/cookieNames';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { KnownPages } from '@/src/knownPages';
import { actionResult, UserFacingError, type ActionState } from '@/src/lib/app/actionResult';
import { showsEmailLinksOnPage } from '@/src/lib/email/send';
import { confirmSignIn, confirmSignInCode, requestSignInLink, SIGN_IN_CODE_ERROR } from '@/src/lib/app/signIn';
import { appCookieOptions, startSession } from '@/src/lib/app/session';
import { signInDestination } from '@/src/lib/app/signInDestination';
import { SIGN_IN_REQUEST_COOKIE_NAME, signInRequestToken } from '@/src/lib/app/signInCookie';
import { emailSchema } from '@/src/lib/app/users';
import { GOOGLE_SIGN_IN_COOKIE_NAME } from '@/src/lib/app/google/cookie';
import { googleLinkIdFor } from '@/src/lib/app/google/link';
import { MICROSOFT_SIGN_IN_COOKIE_NAME } from '@/src/lib/app/microsoft/cookie';
import { microsoftLinkIdFor } from '@/src/lib/app/microsoft/link';

export type SignInLinkSent = {
    email: string;
    requestId: string;
    /** The link's path, only where no email is sent (locally and on previews) */
    devLink?: string;
    devCode?: string;
};

export async function requestSignInAction(_: ActionState<SignInLinkSent>, formData: FormData): Promise<ActionState<SignInLinkSent>> {
    return await actionResult(async () => {
        const email = emailSchema.parse(formData.get('email') ?? '');
        const next = formData.get('next');
        // Microsoft linking is explicit; an unrelated email sign-in never attaches a waiting identity.
        const linkingMicrosoft = formData.get('linkProvider') === 'microsoft';
        const microsoftLinkId = linkingMicrosoft ? await microsoftLinkIdFor((await cookies()).get(MICROSOFT_SIGN_IN_COOKIE_NAME)?.value) : undefined;
        if (linkingMicrosoft && !microsoftLinkId) throw new UserFacingError('This sign-in has expired. Start again.');
        const googleLinkId = linkingMicrosoft ? undefined : await googleLinkIdFor((await cookies()).get(GOOGLE_SIGN_IN_COOKIE_NAME)?.value, email);
        const sent = await requestSignInLink(email, typeof next === 'string' ? next : undefined, googleLinkId, microsoftLinkId);
        const remainingSeconds = Math.max(0, Math.floor((sent.expiresAt - Date.now()) / 1000));
        (await cookies()).set(SIGN_IN_REQUEST_COOKIE_NAME,
            signInRequestToken(sent.requestId, remainingSeconds), appCookieOptions(remainingSeconds));
        const { pathname, search } = new URL(sent.url);
        const showCredentials = showsEmailLinksOnPage();
        return { email, requestId: sent.requestId,
            devLink: showCredentials ? `${pathname}${search}` : undefined,
            devCode: showCredentials ? sent.code : undefined };
    });
}

export async function confirmSignInCodeAction(_: ActionState, formData: FormData): Promise<ActionState> {
    const result = await actionResult(async () => await confirmSignInCode(
        formData.get('requestId'), formData.get('code'),
        readMigratingCookie(await cookies(), cookieNames.signInRequest)
    ));
    if (!result?.ok)
        return result;
    if (!result.data)
        return { ok: false, error: SIGN_IN_CODE_ERROR };

    // The code came from the account's inbox: this sign-in proves its email, also when it links a provider
    const confirmed = result.data;
    const session = await actionResult(() => startSession(confirmed.user.id, confirmed.method, confirmed.user.email));
    if (!session?.ok) return session;
    const proof = session.data;
    redirect(await signInDestination(result.data.user, afterSignIn(result.data), proof));
}

/**
 * Where a confirmed sign-in continues: `next`, or the app, which a new account opens on its first-run
 * step (straight there, without a detour through `/app`)
 */
function afterSignIn({ user, next }: { user: { welcomePending?: boolean }; next?: string }) {
    return next ?? (user.welcomePending ? KnownPages.AppWelcome : KnownPages.App);
}

export async function confirmSignInAction(_: ActionState, formData: FormData): Promise<ActionState> {
    const result = await actionResult(async () => await confirmSignIn(formData.get('token'),
        readMigratingCookie(await cookies(), cookieNames.signInRequest)));
    if (!result?.ok)
        return result;
    if (!result.data)
        return { ok: false, error: 'This link has expired or was already used. Ask for a new one.' };

    // The link came from the account's inbox: this sign-in proves its email
    const confirmed = result.data;
    const session = await actionResult(() => startSession(confirmed.user.id, confirmed.method, confirmed.user.email));
    if (!session?.ok) return session;
    const proof = session.data;
    redirect(await signInDestination(result.data.user, afterSignIn(result.data), proof));
}
