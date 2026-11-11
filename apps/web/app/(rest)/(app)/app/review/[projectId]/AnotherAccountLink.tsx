'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { buttonVariants } from '@/src/components/ui/button';
import { KnownPages } from '@/src/knownPages';

/**
 * Add account (or pick another signed-in one) and come back to this review link. `not-found.tsx`
 * gets no props, so the link is read from the address bar.
 */
export function AnotherAccountLink() {
    const { t, language } = useAppI18n();
    const pathname = usePathname();
    const search = useSearchParams().toString();
    const next = `${pathname}${search ? `?${search}` : ''}`;
    return (
        <Link href={`${KnownPages.AppSignIn}?${new URLSearchParams({ add: '1', next })}`} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
            {t("Use another account")}{' '}</Link>
    );
}
