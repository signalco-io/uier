import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { KnownPages } from '@/src/knownPages';
import { getSessionUser } from '@/src/lib/app/session';
import { safeNextPath } from '@/src/lib/app/signIn';
import { SignInForm } from './SignInForm';

export const metadata: Metadata = {
    title: 'Sign in'
};

export default async function SignInPage({ searchParams }: PageProps<'/app/sign-in'>) {
    const { next } = await searchParams;
    const nextPath = safeNextPath(next);
    if (await getSessionUser())
        redirect(nextPath ?? KnownPages.App);

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1.5">
                <h1 className="m-0 text-[28px] font-semibold leading-[34px] tracking-[-0.02em]">Sign in</h1>
                <p className="m-0 text-sm text-muted-foreground">
                    Enter your email and we will send you a link. New here? The same link creates your account.
                </p>
            </div>
            <SignInForm next={nextPath} />
        </div>
    );
}
