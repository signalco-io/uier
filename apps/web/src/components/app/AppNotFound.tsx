'use client';

import Link from 'next/link';
import { StatusPage } from '@/src/components/StatusPage';
import { buttonVariants } from '@/src/components/ui/button';
import { KnownPages } from '@/src/knownPages';
import { useAppI18n } from '@/src/lib/i18n/client';

/** App-only missing pages use the selected account/browser language. Public 404s keep their own copy. */
export function AppNotFound() {
    const { t } = useAppI18n();
    return <StatusPage code="404" title={t('This page is not here')} note={t('Nothing to review here.')}
        description={t('The link may be old or mistyped, or the page has moved.')} homeLabel={t('uier home')}
        actions={<>
            <Link className={buttonVariants({ size: 'lg' })} href={KnownPages.AppProjects}>{t('Open your projects')}</Link>
            <Link className={buttonVariants({ variant: 'outline', size: 'lg' })} href={KnownPages.Landing}>{t('Go to the home page')}</Link>
        </>} />;
}
