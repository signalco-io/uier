'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import type { PropsWithChildren } from 'react';
import Link from 'next/link';
import { Logo } from '@uier/brand/Logo';
import { Card } from '@/src/components/ui/card';
import { KnownPages } from '@/src/knownPages';

/** Pages outside the app shell (sign in, invitations, the browser extension's sign-in): one card in the middle of the page */
export default function AuthLayout({ children }: PropsWithChildren) {
    const { t } = useAppI18n();
    return (
        <main className="flex min-h-svh flex-col items-center bg-muted/40 px-4 py-16 md:justify-center md:py-10">
            <div className="flex w-full max-w-sm flex-col items-center gap-8">
                <Link href={KnownPages.Landing} aria-label={t("uier home")} className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                    <Logo size={24} />
                </Link>
                <Card className="w-full">{children}</Card>
                <nav aria-label={t("Legal")} className="flex gap-4 text-xs text-muted-foreground">
                    <Link href={KnownPages.LegalTermsOfService} className="hover:text-foreground">{t("Terms of service")}</Link>
                    <Link href={KnownPages.LegalPrivacyPolicy} className="hover:text-foreground">{t("Privacy policy")}</Link>
                </nav>
            </div>
        </main>
    );
}
