import { getAppI18n } from '@/src/lib/i18n/server';
import { AuthCardLoading } from '@/src/components/app/AuthFrame';
import { signInOutline } from '@/src/components/app/signInOutline';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { KnownPages } from '@/src/knownPages';
import { getBrowserAccounts, getLastSignInMethod, getSessionUser } from '@/src/lib/app/session';
import { safeNextPath } from '@/src/lib/app/signIn';
import { appLinkMetadata, describeAppLink } from '@/src/lib/metadata';
import { SignedInAccounts } from '@/src/components/app/shell/SignedInAccounts';
import { ForgetShellCache } from '@/src/components/app/shell/ForgetShellCache';
import { ACCOUNT_LIMIT_MESSAGE } from '@/src/lib/app/browserAccounts';
import { isAccountDeletedNotice } from '@/src/lib/app/accountDeletedNotice';
import { isGoogleSignInConfigured } from '@/src/lib/app/google/config';
import { isMicrosoftSignInConfigured } from '@/src/lib/app/microsoft/config';
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
    const { t } = await getAppI18n();
    return { title: t('Sign in'), ...appLinkMetadata(describeAppLink(safeNextPath(next))) };
}

async function SignInPageContent({ searchParams }: PageProps<'/app/sign-in'>) {
    const { t } = await getAppI18n();
    const { next, google, microsoft, with: method, add, again, deleted, accounts: accountProblem } = await searchParams;
    const nextPath = safeNextPath(next);
    if (add !== '1' && await getSessionUser())
        redirect(nextPath ?? KnownPages.App);
    const [lastUsed, accounts] = await Promise.all([getLastSignInMethod(), getBrowserAccounts()]);
    // Sign in again, from a step that needs a recent sign-in (`KnownPageLinks.signInAgain`)
    const signingInAgain = add === '1' && again === '1';

    // The form renders the card: once the email is sent, the code step has its own header
    return (
        <>
        <ForgetShellCache everything={accounts.length === 0} />
        <SignedInAccounts accounts={accounts} next={nextPath} />
        <SignInForm addingAccount={add === '1'} again={signingInAgain} providersNeedProof={signingInAgain && (isGoogleSignInConfigured() || isMicrosoftSignInConfigured())}
            next={nextPath} withEmail={method === 'email'} lastUsed={lastUsed}
            problems={<>
                {isAccountDeletedNotice(deleted, null) && <Alert role="status"><AlertDescription>{t('Your account has been deleted.')}</AlertDescription></Alert>}
                {accountProblem === 'full' && <Alert role="alert"><AlertDescription>{t(ACCOUNT_LIMIT_MESSAGE)}</AlertDescription></Alert>}
                <GoogleSignInProblem outcome={google} />
                <MicrosoftSignInProblem outcome={microsoft} />
            </>}
            alternatives={<>
                <GoogleSignInButton addingAccount={add === '1'} again={signingInAgain} next={nextPath} lastUsed={lastUsed === 'google'} />
                <MicrosoftSignInButton addingAccount={add === '1'} again={signingInAgain} next={nextPath} lastUsed={lastUsed === 'microsoft'} />
            </>} />
        </>
    );
}

export default function SignInPage(props: Parameters<typeof SignInPageContent>[0]) {
    return <Suspense fallback={<AuthCardLoading label="Loading sign-in" {...signInOutline} />}><SignInPageContent {...props} /></Suspense>;
}
