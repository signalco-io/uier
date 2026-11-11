
import { getAppI18n } from '@/src/lib/i18n/server';
import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { cn } from 'cn';
import { buttonVariants } from '@/src/components/ui/button';
import { AuthCard } from '@/src/components/app/AuthCard';
import { KnownPages } from '@/src/knownPages';
import { GOOGLE_SIGN_IN_COOKIE_NAME } from '@/src/lib/app/google/cookie';
import { getGoogleLink } from '@/src/lib/app/google/link';
import { GoogleLinkForm } from './GoogleLinkForm';

export const metadata: Metadata = {
    title: 'Confirm your email'
};

/**
 * Google is not authoritative for this address (not Gmail, not a Workspace domain), so the person
 * proves the inbox once before the Google account is linked. The page never says whether a uier
 * account already uses the address.
 */
export default async function GoogleLinkPage() {
    const { t, language } = await getAppI18n();
    const link = await getGoogleLink((await cookies()).get(GOOGLE_SIGN_IN_COOKIE_NAME)?.value);

    if (!link) {
        return (
            <AuthCard title={t("This sign-in has expired")} description={t("Start again with Google, or sign in with your email.")}>
                <Link href={`${KnownPages.AppSignIn}?add=1`} className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'w-full')}>{t("Sign in again")}</Link>
            </AuthCard>
        );
    }

    return (
        <AuthCard
            title={t("Confirm your email")}
            description={<>
                {t("Confirm")}{' '}<span className="font-medium text-foreground">{link.email}</span> {t("once with an email code to finish signing in with Google.")}{' '}</>}>
            <GoogleLinkForm email={link.email} next={link.next} />
        </AuthCard>
    );
}
