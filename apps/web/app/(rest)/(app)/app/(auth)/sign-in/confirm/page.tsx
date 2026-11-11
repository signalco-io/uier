import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { cn } from 'cn';
import { buttonVariants } from '@/src/components/ui/button';
import { KnownPages } from '@/src/knownPages';
import { getSignInRequest } from '@/src/lib/app/signIn';
import { AuthCard } from '@/src/components/app/AuthCard';
import { ConfirmSignInForm } from './ConfirmSignInForm';

export const metadata: Metadata = {
    title: 'Sign in'
};

async function ConfirmSignInPageContent({ searchParams }: PageProps<'/app/sign-in/confirm'>) {
    const { token } = await searchParams;
    const request = await getSignInRequest(token);

    if (!request || typeof token !== 'string') {
        return (
            <AuthCard title="This link has expired" description="Sign-in links work once and expire after 15 minutes. Ask for a new one.">
                <Link href={KnownPages.AppSignIn} className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'w-full')}>Sign in again</Link>
            </AuthCard>
        );
    }

    return (
        <AuthCard
            title="Sign in"
            description={<>Continue as <span className="font-medium text-foreground">{request.email}</span>.</>}>
            <ConfirmSignInForm token={token} />
        </AuthCard>
    );
}

export default function ConfirmSignInPage(props: Parameters<typeof ConfirmSignInPageContent>[0]) {
    return <Suspense fallback={<PageLoading title="Loading confirm" />}><ConfirmSignInPageContent {...props} /></Suspense>;
}
