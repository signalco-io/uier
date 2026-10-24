import type { Metadata } from 'next';
import { Button } from '@signalco/ui-primitives/Button';
import { KnownPages } from '@/src/knownPages';
import { getSignInRequest } from '@/src/lib/app/signIn';
import { ConfirmSignInForm } from './ConfirmSignInForm';

export const metadata: Metadata = {
    title: 'Sign in'
};

export default async function ConfirmSignInPage({ searchParams }: PageProps<'/app/sign-in/confirm'>) {
    const { token } = await searchParams;
    const request = await getSignInRequest(token);

    if (!request || typeof token !== 'string') {
        return (
            <div className="flex flex-col gap-4">
                <h1 className="m-0 text-[28px] font-semibold leading-[34px] tracking-[-0.02em]">This link has expired</h1>
                <p className="m-0 text-sm text-muted-foreground">
                    Sign-in links work once and expire after 15 minutes. Ask for a new one.
                </p>
                <Button href={KnownPages.AppSignIn} variant="outlined" size="lg" className="self-start">Sign in again</Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1.5">
                <h1 className="m-0 text-[28px] font-semibold leading-[34px] tracking-[-0.02em]">Sign in</h1>
                <p className="m-0 text-sm text-muted-foreground">
                    Continue as <span className="font-medium text-foreground">{request.email}</span>.
                </p>
            </div>
            <ConfirmSignInForm token={token} />
        </div>
    );
}
