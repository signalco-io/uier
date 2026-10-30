import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Button } from '@/src/components/ui/button';
import { AuthCard } from '@/src/components/app/AuthCard';
import { KnownPages } from '@/src/knownPages';
import { getSessionUser } from '@/src/lib/app/session';
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
    if (await getSessionUser())
        redirect(KnownPages.App);
    const link = await getGoogleLink((await cookies()).get(GOOGLE_SIGN_IN_COOKIE_NAME)?.value);

    if (!link) {
        return (
            <AuthCard title="This sign-in has expired" description="Start again with Google, or sign in with your email.">
                <Button variant="outline" size="lg" className="w-full" asChild>
                    <Link href={KnownPages.AppSignIn}>Sign in again</Link>
                </Button>
            </AuthCard>
        );
    }

    return (
        <AuthCard
            title="Confirm your email"
            description={<>
                Confirm <span className="font-medium text-foreground">{link.email}</span> once with an email code
                to finish signing in with Google.
            </>}>
            <GoogleLinkForm email={link.email} next={link.next} />
        </AuthCard>
    );
}
