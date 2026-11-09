import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { KnownPages } from '@/src/knownPages';
import { getBrowserAccounts, getLastSignInMethod, getSessionUser } from '@/src/lib/app/session';
import { safeNextPath } from '@/src/lib/app/signIn';
import { appLinkMetadata, describeAppLink } from '@/src/lib/metadata';
import { SignedInAccounts } from '@/src/components/app/shell/SignedInAccounts';
import { ACCOUNT_LIMIT_MESSAGE } from '@/src/lib/app/browserAccounts';
import { Alert, AlertDescription } from '@/src/components/ui/alert';
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
    const { next, google, microsoft, with: method, add, accounts: accountProblem } = await searchParams;
    const nextPath = safeNextPath(next);
    if (add !== '1' && await getSessionUser())
        redirect(nextPath ?? KnownPages.App);
    const [lastUsed, accounts] = await Promise.all([getLastSignInMethod(), getBrowserAccounts()]);

    // The form renders the card: once the email is sent, the code step has its own header
    return (
        <>
        <SignedInAccounts accounts={accounts} next={nextPath} />
        <SignInForm addingAccount={add === '1'} next={nextPath} withEmail={method === 'email'} lastUsed={lastUsed}
            problems={<>
                {accountProblem === 'full' && <Alert role="alert"><AlertDescription>{ACCOUNT_LIMIT_MESSAGE}</AlertDescription></Alert>}
                <GoogleSignInProblem outcome={google} />
                <MicrosoftSignInProblem outcome={microsoft} />
            </>}
            alternatives={<>
                <GoogleSignInButton addingAccount={add === '1'} next={nextPath} lastUsed={lastUsed === 'google'} />
                <MicrosoftSignInButton addingAccount={add === '1'} next={nextPath} lastUsed={lastUsed === 'microsoft'} />
            </>} />
        </>
    );
}
