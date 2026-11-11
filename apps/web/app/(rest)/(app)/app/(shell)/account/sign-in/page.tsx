import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Section } from '@/src/components/app/PageHeader';
import { requireAppContext } from '@/src/lib/app/context';
import { SignOutButton } from '@/src/components/app/shell/SignOutButton';
import { GoogleAccount } from '../GoogleAccount';
import { MicrosoftAccount } from '../MicrosoftAccount';
import { PasskeysSection } from '../PasskeysSection';

export const metadata: Metadata = {
    title: 'Sign-in · Account'
};

/** How the person signs in: linked Google and Microsoft accounts, passkeys, and signing out of this browser */
async function AccountSignInPageContent() {
    const { user } = await requireAppContext();
    return (
        <>
            <GoogleAccount userId={user.id} />
            <MicrosoftAccount userId={user.id} />
            <PasskeysSection userId={user.id} />
            <Section id="session" title="Sign out" description="Sign out of uier on this browser." actions={<SignOutButton />} />
        </>
    );
}

export default function AccountSignInPage() {
    return <Suspense fallback={<PageLoading title="Loading sign in" />}><AccountSignInPageContent /></Suspense>;
}
