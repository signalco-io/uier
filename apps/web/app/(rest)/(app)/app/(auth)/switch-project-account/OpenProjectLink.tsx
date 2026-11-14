'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AuthCard } from '@/src/components/app/AuthCard';
import { PageLoading } from '@/src/components/app/PageLoading';
import { Alert, AlertDescription } from '@/src/components/ui/alert';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { changeAccount } from '@/src/components/app/shell/accountSessions';
import { KnownPages } from '@/src/knownPages';
import { useAppI18n } from '@/src/lib/i18n/client';

/** Mounted navigation only: RSC/prefetch reads do not select a browser identity. */
export function OpenProjectLink({ next }: { next: string }) {
    const { t } = useAppI18n();
    const started = useRef<string | null>(null);
    const [error, setError] = useState(false);
    useEffect(() => {
        if (started.current === next) return;
        started.current = next;
        void changeAccount({ action: 'open-project-link', next }).catch(() => setError(true));
    }, [next]);
    if (!error) return <PageLoading />;
    return <AuthCard title={t('Switch account or workspace')}>
        <div className="flex flex-col gap-4">
            <Alert variant="destructive"><AlertDescription>{t('Something went wrong. Try again.')}</AlertDescription></Alert>
            <Button onClick={() => window.location.reload()}>{t('Try again')}</Button>
            <Link href={KnownPages.AppProjects} className={buttonVariants({ variant: 'ghost' })}>{t('Cancel')}</Link>
        </div>
    </AuthCard>;
}
