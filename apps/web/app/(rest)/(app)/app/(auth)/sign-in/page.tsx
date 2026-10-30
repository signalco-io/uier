import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { KnownPages } from '@/src/knownPages';
import { getSessionUser } from '@/src/lib/app/session';
import { safeNextPath } from '@/src/lib/app/signIn';
import { AuthCard } from '@/src/components/app/AuthCard';
import { SignInForm } from './SignInForm';
import { GoogleSignIn } from './GoogleSignIn';

export const metadata: Metadata = {
    title: 'Sign in'
};

export default async function SignInPage({ searchParams }: PageProps<'/app/sign-in'>) {
    const { next, google } = await searchParams;
    const nextPath = safeNextPath(next);
    if (await getSessionUser())
        redirect(nextPath ?? KnownPages.App);

    return (
        <AuthCard
            title="Sign in"
            description="Enter your email and we will send you a code and a link. New here? Signing in creates your account.">
            <GoogleSignIn next={nextPath} outcome={google} />
            <SignInForm next={nextPath} />
        </AuthCard>
    );
}
