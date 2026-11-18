'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import { Section } from '../PageHeader';
import { SignOutButton } from '../shell/SignOutButton';
import { accountTitles } from './accountSections';

/**
 * Account → Sign-in's last card: signing out of this browser. It shows nothing of the account, so it is outside
 * the page's data boundary: the real card and its button while the sign-in methods above it load.
 */
export function SignOutSection() {
    const { t } = useAppI18n();
    return <Section id="session" title={t(accountTitles.signOut)} description={t("Sign out of uier on this browser.")} actions={<SignOutButton />} />;
}
