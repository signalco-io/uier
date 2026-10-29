'use server';

import { cookieNames, readMigratingCookie } from '@/src/lib/cookieNames';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { KnownPages } from '@/src/knownPages';
import { actionResult, type ActionState } from '@/src/lib/app/actionResult';
import { showsEmailLinksOnPage } from '@/src/lib/email/send';
import { confirmSignIn, confirmSignInCode, requestSignInLink, SIGN_IN_CODE_ERROR } from '@/src/lib/app/signIn';
import { appCookieOptions, startSession } from '@/src/lib/app/session';
import { SIGN_IN_REQUEST_COOKIE_NAME, signInRequestToken } from '@/src/lib/app/signInCookie';
import { emailSchema } from '@/src/lib/app/users';

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
        const sent = await requestSignInLink(email, typeof next === 'string' ? next : undefined);
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

    await startSession(result.data.user.id);
    redirect(result.data.next ?? KnownPages.App);
}

export async function confirmSignInAction(_: ActionState, formData: FormData): Promise<ActionState> {
    const result = await actionResult(async () => await confirmSignIn(formData.get('token')));
    if (!result?.ok)
        return result;
    if (!result.data)
        return { ok: false, error: 'This link has expired or was already used. Ask for a new one.' };

    await startSession(result.data.user.id);
    redirect(result.data.next ?? KnownPages.App);
}
