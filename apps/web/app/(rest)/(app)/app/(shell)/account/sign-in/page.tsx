import { getAppI18n } from '@/src/lib/i18n/server';
import { AccountSignInLoading } from '@/src/components/app/account/AccountLoading';
import { SignOutSection } from '@/src/components/app/account/SignOutSection';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requireAppContext } from '@/src/lib/app/context';
import { GoogleAccount } from '../GoogleAccount';
import { MicrosoftAccount } from '../MicrosoftAccount';
import { PasskeysSection } from '../PasskeysSection';

export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getAppI18n();
    return {
    title: t('Sign-in · Account')
};
}

/** How the person signs in: linked Google and Microsoft accounts and passkeys */
async function AccountSignInPageContent() {
    const { user } = await requireAppContext();
    return (
        <>
            <GoogleAccount userId={user.id} />
            <MicrosoftAccount userId={user.id} />
            <PasskeysSection userId={user.id} />
        </>
    );
}

/** The sign-in methods load; signing out of this browser needs nothing from the account, so its card is there at once */
export default function AccountSignInPage() {
    return (
        <>
            <Suspense fallback={<AccountSignInLoading />}><AccountSignInPageContent /></Suspense>
            <SignOutSection />
        </>
    );
}
