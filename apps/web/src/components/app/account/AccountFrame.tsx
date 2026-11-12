'use client';

import type { PropsWithChildren, ReactNode } from 'react';
import { useAppI18n } from '@/src/lib/i18n/client';
import { KnownPageLinks } from '@/src/knownPages';
import { PageHeader } from '../PageHeader';
import { SettingsLayout, settingsTabs } from '../SettingsLayout';
import { accountSections } from './accountSections';

/** Reuse the current layout's language while the email and section data stream separately. */
export function AccountFrame({ email, children }: PropsWithChildren<{ email: ReactNode }>) {
    const { t } = useAppI18n();
    return <>
        <PageHeader title={<span data-testid="account-heading">{t('Account')}</span>} description={email} />
        <SettingsLayout tabs={settingsTabs(accountSections, KnownPageLinks.account)} label={t('Account')}>
            {children}
        </SettingsLayout>
    </>;
}
