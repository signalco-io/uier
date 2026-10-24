'use server';

import { redirect } from 'next/navigation';
import { KnownPages } from '@/src/knownPages';
import { actionResult, type ActionState } from '@/src/lib/app/actionResult';
import { showsEmailLinksOnPage } from '@/src/lib/email/send';
import { confirmSignIn, requestSignInLink } from '@/src/lib/app/signIn';
import { startSession } from '@/src/lib/app/session';
import { emailSchema } from '@/src/lib/app/users';

export type SignInLinkSent = {
    email: string;
    /** The link's path, only where no email is sent (locally and on previews) */
    devLink?: string;
};

export async function requestSignInAction(_: ActionState<SignInLinkSent>, formData: FormData): Promise<ActionState<SignInLinkSent>> {
    return await actionResult(async () => {
        const email = emailSchema.parse(formData.get('email') ?? '');
        const next = formData.get('next');
        const link = await requestSignInLink(email, typeof next === 'string' ? next : undefined);
        const { pathname, search } = new URL(link);
        return { email, devLink: showsEmailLinksOnPage() ? `${pathname}${search}` : undefined };
    });
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
