
import { getAppI18n } from '@/src/lib/i18n/server';
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
export default async function AccountSignInPage() {
    const { t, language } = await getAppI18n();
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
