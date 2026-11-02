import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { KnownPages } from '@/src/knownPages';
import { getLastSignInMethod, getSessionUser } from '@/src/lib/app/session';
import { safeNextPath } from '@/src/lib/app/signIn';
import { appLinkMetadata, describeAppLink } from '@/src/lib/social/metadata';
import { AuthCard } from '@/src/components/app/AuthCard';
import { SignInForm } from './SignInForm';
import { GoogleSignInButton, GoogleSignInProblem } from './GoogleSignIn';
import { MicrosoftSignInButton, MicrosoftSignInProblem } from './MicrosoftSignIn';

/**
 * Link previews are fetched signed out, so a shared comment or review link arrives here: its
 * preview says what kind of link it is (`?next=`), and the browser tab still says Sign in.
 */
export async function generateMetadata({ searchParams }: PageProps<'/app/sign-in'>): Promise<Metadata> {
    const { next } = await searchParams;
    return { title: 'Sign in', ...appLinkMetadata(describeAppLink(safeNextPath(next))) };
}

export default async function SignInPage({ searchParams }: PageProps<'/app/sign-in'>) {
    const { next, google, microsoft, with: method } = await searchParams;
    const nextPath = safeNextPath(next);
    if (await getSessionUser())
        redirect(nextPath ?? KnownPages.App);
    const lastUsed = await getLastSignInMethod();

    return (
        <AuthCard
            title="Sign in"
            description={<>Choose how to sign in.<br />New here? Signing in creates your account.</>}>
            <GoogleSignInProblem outcome={google} />
            <MicrosoftSignInProblem outcome={microsoft} />
            <SignInForm next={nextPath} withEmail={method === 'email'} lastUsed={lastUsed}
                alternatives={<>
                    <GoogleSignInButton next={nextPath} lastUsed={lastUsed === 'google'} />
                    <MicrosoftSignInButton next={nextPath} lastUsed={lastUsed === 'microsoft'} />
                </>} />
        </AuthCard>
    );
}
