import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { KnownPages } from '@/src/knownPages';
import { getSessionUser } from '@/src/lib/app/session';
import { safeNextPath } from '@/src/lib/app/signIn';
import { AuthCard } from '@/src/components/app/AuthCard';
import { SignInForm } from './SignInForm';
import { GoogleSignInButton, GoogleSignInProblem } from './GoogleSignIn';
import { MicrosoftSignInButton, MicrosoftSignInProblem } from './MicrosoftSignIn';

export const metadata: Metadata = {
    title: 'Sign in'
};

export default async function SignInPage({ searchParams }: PageProps<'/app/sign-in'>) {
    const { next, google, microsoft, with: method } = await searchParams;
    const nextPath = safeNextPath(next);
    if (await getSessionUser())
        redirect(nextPath ?? KnownPages.App);

    return (
        <AuthCard
            title="Sign in"
            description="Choose how to sign in. New here? Signing in creates your account.">
            <GoogleSignInProblem outcome={google} />
            <MicrosoftSignInProblem outcome={microsoft} />
            <SignInForm next={nextPath} withEmail={method === 'email'}
                alternatives={<><GoogleSignInButton next={nextPath} /><MicrosoftSignInButton next={nextPath} /></>} />
        </AuthCard>
    );
}
