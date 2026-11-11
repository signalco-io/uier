'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { StatusPage } from '@/src/components/StatusPage';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { KnownPages } from '@/src/knownPages';
import { useAppI18n } from '@/src/lib/i18n/client';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    const { t } = useAppI18n();
    useEffect(() => { console.error(error); }, [error]);
    return <StatusPage code={error.digest ? t('Error {id}', { id: error.digest }) : t('Error')}
        title={t('Something went wrong')} note={t('This part did not load.')} homeLabel={t('uier home')}
        description={t('The page could not load. Try again, or start from the home page.')}
        actions={<>
            <Button onClick={reset}>{t('Try again')}</Button>
            <Link className={buttonVariants({ variant: 'outline' })} href={KnownPages.Landing}>{t('Go to the home page')}</Link>
        </>} />;
}
