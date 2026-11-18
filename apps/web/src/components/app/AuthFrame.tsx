'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Logo } from '@uier/brand/Logo';
import { useAppI18n } from '@/src/lib/i18n/client';
import { cn } from '@/src/lib/utils';
import { Card, CardContent, CardHeader } from '@/src/components/ui/card';
import { KnownPages } from '@/src/knownPages';
import { Bar, Loading } from './loading/outlines';

/**
 * A card's content while it loads, laid out as `AuthCard` lays it out (the card's own padding, so nothing touches
 * its edges): the heading, `description` lines under it, then `actions` controls. The sign-in card has two lines and
 * four controls (`signInOutline.ts`: a passkey, Google, Microsoft and the email), so it is as tall as the form a
 * deployment with every sign-in option shows; a confirmation or an invitation has one control. `lines` adds rows
 * above the controls (what a consent lists).
 */
export function AuthCardOutline({ actions = 1, lines = 0, description = 1 }: { actions?: number; lines?: number; description?: number }) {
    return (
        <>
            <CardHeader aria-hidden="true">
                <span className="flex h-7 items-center"><Bar className="h-5 w-40" /></span>
                <span className="flex flex-col">
                    {Array.from({ length: description }, (_, line) => (
                        <span key={line} className="flex h-5 items-center"><Bar className={cn('h-3.5 max-w-full', line ? 'w-56' : 'w-40')} /></span>
                    ))}
                </span>
            </CardHeader>
            <CardContent aria-hidden="true" className="flex flex-col gap-3">
                {Array.from({ length: lines }, (_, line) => <Bar key={line} className={cn('h-4', line % 2 ? 'w-2/3' : 'w-5/6')} />)}
                {Array.from({ length: actions }, (_, action) => <Bar key={action} className="h-10 w-full rounded-lg" />)}
            </CardContent>
        </>
    );
}

/** A page of the card while its own data loads: the outline behind one status */
export function AuthCardLoading({ label, actions, lines, description }: { label: string; actions?: number; lines?: number; description?: number }) {
    return <Loading label={label} className="contents"><AuthCardOutline actions={actions} lines={lines} description={description} /></Loading>;
}

/**
 * The frame of the pages outside the app shell (sign in, invitations, the browser extension's sign-in, a coding
 * tool's consent): the logo, one card in the middle of the page, the legal links. `wide` is the consent's wider card.
 *
 * With `loading` it is the same frame before the request is known, for the static shell: the logo and the card with
 * an outline of its content. The legal links are bars, since their text needs the language. Inert, behind one status.
 */
export function AuthFrame({ children, wide = false, loading = false, actions, description }: { children?: ReactNode; wide?: boolean; loading?: boolean; actions?: number; description?: number }) {
    const { t } = useAppI18n();
    const main = cn('flex min-h-svh flex-col items-center bg-muted/40 px-4 md:justify-center', wide ? 'py-10' : 'py-16 md:py-10');
    const column = cn('flex w-full flex-col items-center gap-8', wide ? 'max-w-lg' : 'max-w-sm');
    if (loading) {
        return (
            <main className={main} data-auth-frame="">
                {/* Before the app's language is known: the page's default language */}
                <span role="status" className="sr-only">Loading…</span>
                <div inert aria-hidden="true" className={column}>
                    {/* In a box like the home link's, whose line is a little taller than the logo: nothing moves when it arrives */}
                    <span><Logo size={24} /></span>
                    <Card className="w-full"><AuthCardOutline actions={actions} description={description} /></Card>
                    <div className="flex h-4 items-center gap-4"><Bar className="h-3 w-24" /><Bar className="h-3 w-20" /></div>
                </div>
            </main>
        );
    }
    return (
        <main className={main}>
            <div className={column}>
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
