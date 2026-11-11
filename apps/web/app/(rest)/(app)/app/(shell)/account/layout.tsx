import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import { KnownPageLinks } from '@/src/knownPages';
import { PageHeader } from '@/src/components/app/PageHeader';
import { SettingsLayout, settingsTabs } from '@/src/components/app/SettingsLayout';
import { accountSections } from '@/src/components/app/account/accountSections';
import { requireAppContext } from '@/src/lib/app/context';

/** The account: its sections beside the chosen one (above it on small screens), like a project's settings */
async function AccountLayoutContent({ children }: LayoutProps<'/app/account'>) {
    const { user } = await requireAppContext();
    return (
        <>
            <PageHeader title="Account" description={<span className="font-mono text-[13px]">{user.email}</span>} />
            <SettingsLayout tabs={settingsTabs(accountSections, KnownPageLinks.account)} label="Account">
                {children}
            </SettingsLayout>
        </>
    );
}

export default function AccountLayout(props: Parameters<typeof AccountLayoutContent>[0]) {
    return <Suspense fallback={<PageLoading title="Loading account" />}><AccountLayoutContent {...props} /></Suspense>;
}
