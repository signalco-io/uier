import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ClockIcon, MousePointerClickIcon } from 'lucide-react';
import { requireAppContext, appContextOrThrow } from '@/src/lib/app/context';
import { issueExtensionCode, validateAuthorization, type Authorization } from '@/src/lib/extension/auth';
import { AuthCard } from '@/src/components/app/AuthCard';
import { Button } from '@/src/components/ui/button';

export const metadata: Metadata = { title: 'Extension sign-in' };

/** The browser extension's sign-in (`identity.launchWebAuthFlow`): one card, like signing in to the app */
export default async function ExtensionConsent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const context = await requireAppContext();
    let input: Authorization;
    try { input = validateAuthorization(await searchParams); }
    catch {
        return <AuthCard title="Extension sign-in is unavailable" description="Use the registered uier extension and try again." />;
    }
    async function approve() {
        'use server';
        const current = await appContextOrThrow();
        redirect(await issueExtensionCode(current.user.id, input));
    }
    return (
        <AuthCard
            title="Sign in to the uier extension"
            description={<>Continue as <span className="font-medium text-foreground">{context.user.name}</span>. The extension can review configured sites in projects you can access.</>}>
            <ul className="m-0 mb-6 flex list-none flex-col gap-3 p-0 text-sm text-muted-foreground">
                <li className="flex gap-2.5">
                    <MousePointerClickIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-foreground" strokeWidth={1.75} />
                    <span>Only sites where you choose Start review are activated.</span>
                </li>
                <li className="flex gap-2.5">
                    <ClockIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-foreground" strokeWidth={1.75} />
                    <span>{input.renewable === 'true'
                        ? 'Stay signed in across browser restarts. Sign-in ends after 30 days without use or after one year.'
                        : 'Sign-in ends after eight hours or when you restart your browser.'}</span>
                </li>
            </ul>
            <form action={approve}>
                <Button type="submit" size="lg" className="w-full">Sign in to uier</Button>
            </form>
        </AuthCard>
    );
}
