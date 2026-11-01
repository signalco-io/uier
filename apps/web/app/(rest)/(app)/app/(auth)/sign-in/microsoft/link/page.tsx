import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cn } from 'cn';
import { buttonVariants } from '@/src/components/ui/button';
import { AuthCard } from '@/src/components/app/AuthCard';
import { KnownPages } from '@/src/knownPages';
import { getSessionUser } from '@/src/lib/app/session';
import { MICROSOFT_SIGN_IN_COOKIE_NAME } from '@/src/lib/app/microsoft/cookie';
import { getMicrosoftLink } from '@/src/lib/app/microsoft/link';
import { MicrosoftLinkForm } from './MicrosoftLinkForm';

export const metadata: Metadata = { title: 'Confirm your email' };

export default async function MicrosoftLinkPage() {
    if (await getSessionUser()) redirect(KnownPages.App);
    const link = await getMicrosoftLink((await cookies()).get(MICROSOFT_SIGN_IN_COOKIE_NAME)?.value);
    if (!link) return (
        <AuthCard title="This sign-in has expired" description="Start again with Microsoft, or sign in with your email.">
            <Link href={KnownPages.AppSignIn} className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'w-full')}>Sign in again</Link>
        </AuthCard>
    );
    return (
        <AuthCard title="Confirm your email" description="Confirm your email once to link your Microsoft account. Use your existing uier email to keep your projects.">
            <MicrosoftLinkForm email={link.email} next={link.next} />
        </AuthCard>
    );
}
