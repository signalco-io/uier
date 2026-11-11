import { getAppI18n } from '@/src/lib/i18n/server';
import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Section } from '@/src/components/app/PageHeader';
import { requireAppContext } from '@/src/lib/app/context';
import { SignOutButton } from '@/src/components/app/shell/SignOutButton';
import { GoogleAccount } from '../GoogleAccount';
import { MicrosoftAccount } from '../MicrosoftAccount';
import { PasskeysSection } from '../PasskeysSection';

export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getAppI18n();
    return {
    title: t('Sign-in · Account')
};
}

/** How the person signs in: linked Google and Microsoft accounts, passkeys, and signing out of this browser */
async function AccountSignInPageContent() {
    const { t } = await getAppI18n();
    const { user } = await requireAppContext();
    return (
        <>
            <GoogleAccount userId={user.id} />
            <MicrosoftAccount userId={user.id} />
            <PasskeysSection userId={user.id} />
            <Section id="session" title={t("Sign out")} description={t("Sign out of uier on this browser.")} actions={<SignOutButton />} />
        </>
    );
}

export default function AccountSignInPage() {
    return <Suspense fallback={<PageLoading title="Loading sign in" />}><AccountSignInPageContent /></Suspense>;
}
