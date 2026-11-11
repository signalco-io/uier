import { getAppI18n } from '@/src/lib/i18n/server';
import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import type { PropsWithChildren } from 'react';
import Link from 'next/link';
import { Logo } from '@uier/brand/Logo';
import { Card } from '@/src/components/ui/card';
import { KnownPages } from '@/src/knownPages';
import { getSessionUser } from '@/src/lib/app/session';
import { AccountSessionBoundary } from '@/src/components/app/shell/AccountSessionBoundary';

/** A coding tool's sign-in (consent and its errors): one focused card, without the app sidebar */
async function ConnectLayoutContent({ children }: PropsWithChildren) {
    const { t } = await getAppI18n();
    const user = await getSessionUser();
    return (
        <main className="flex min-h-svh flex-col items-center bg-muted/40 px-4 py-10 md:justify-center">
            <AccountSessionBoundary userId={user?.id ?? null} reloadOnChange />
            <div className="flex w-full max-w-lg flex-col items-center gap-8">
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

export default function ConnectLayout(props: Parameters<typeof ConnectLayoutContent>[0]) {
    return <Suspense fallback={<PageLoading title="Loading connect" />}><ConnectLayoutContent {...props} /></Suspense>;
}
