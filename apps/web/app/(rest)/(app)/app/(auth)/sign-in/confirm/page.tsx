import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/src/components/ui/button';
import { KnownPages } from '@/src/knownPages';
import { getSignInRequest } from '@/src/lib/app/signIn';
import { AuthCard } from '@/src/components/app/AuthCard';
import { ConfirmSignInForm } from './ConfirmSignInForm';

export const metadata: Metadata = {
    title: 'Sign in'
};

export default async function ConfirmSignInPage({ searchParams }: PageProps<'/app/sign-in/confirm'>) {
    const { token } = await searchParams;
    const request = await getSignInRequest(token);

    if (!request || typeof token !== 'string') {
        return (
            <AuthCard title="This link has expired" description="Sign-in links work once and expire after 15 minutes. Ask for a new one.">
                <Button variant="outline" size="lg" className="w-full" asChild>
                    <Link href={KnownPages.AppSignIn}>Sign in again</Link>
                </Button>
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
