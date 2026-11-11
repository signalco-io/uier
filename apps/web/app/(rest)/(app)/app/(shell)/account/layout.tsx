
import { getAppI18n } from '@/src/lib/i18n/server';
import { KnownPageLinks } from '@/src/knownPages';
import { PageHeader } from '@/src/components/app/PageHeader';
import { SettingsLayout, settingsTabs } from '@/src/components/app/SettingsLayout';
import { accountSections } from '@/src/components/app/account/accountSections';
import { requireAppContext } from '@/src/lib/app/context';

/** The account: its sections beside the chosen one (above it on small screens), like a project's settings */
export default async function AccountLayout({ children }: LayoutProps<'/app/account'>) {
    const { t, language } = await getAppI18n();
    const { user } = await requireAppContext();
    return (
        <>
            <PageHeader title={t("Account")} description={<span className="font-mono text-[13px]">{user.email}</span>} />
            <SettingsLayout tabs={settingsTabs(accountSections, KnownPageLinks.account)} label={t("Account")}>
                {children}
            </SettingsLayout>
        </>
    );
}
