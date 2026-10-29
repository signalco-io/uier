import type { PropsWithChildren } from 'react';
import Link from 'next/link';
import { Logo } from '@uier/brand/Logo';
import { Card } from '@/src/components/ui/card';
import { KnownPages } from '@/src/knownPages';

/** A coding tool's sign-in (consent and its errors): one focused card, without the app sidebar */
export default function ConnectLayout({ children }: PropsWithChildren) {
    return (
        <main className="flex min-h-svh flex-col items-center bg-muted/40 px-4 py-10 md:justify-center">
            <div className="flex w-full max-w-lg flex-col items-center gap-8">
                <Link href={KnownPages.Landing} aria-label="uier home" className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                    <Logo size={24} />
                </Link>
                <Card className="w-full">{children}</Card>
                <nav aria-label="Legal" className="flex gap-4 text-xs text-muted-foreground">
                    <Link href={KnownPages.LegalTermsOfService} className="hover:text-foreground">Terms of service</Link>
                    <Link href={KnownPages.LegalPrivacyPolicy} className="hover:text-foreground">Privacy policy</Link>
                </nav>
            </div>
        </main>
    );
}
