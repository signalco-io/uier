import { redirect } from 'next/navigation';
import { requireAppContext, appContextOrThrow } from '@/src/lib/app/context';
import { issueExtensionCode, validateAuthorization, type Authorization } from '@/src/lib/extension/auth';
import { Button } from '@/src/components/ui/button';
import { Logo } from '@uier/brand/Logo';

export default async function ExtensionConsent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const context = await requireAppContext();
    let input: Authorization;
    try { input = validateAuthorization(await searchParams); }
    catch { return <main className="mx-auto max-w-md p-6"><h1 className="text-xl font-semibold">Extension sign-in is unavailable</h1><p>Use the registered uier extension and try again.</p></main>; }
    async function approve() {
        'use server';
        const current = await appContextOrThrow();
        redirect(await issueExtensionCode(current.user.id, input));
    }
    return <main className="mx-auto flex max-w-md flex-col gap-4 rounded-xl border p-6">
        <Logo />
        <h1 className="text-xl font-semibold">Sign in to the uier extension</h1>
        <p>Continue as {context.user.name}. The extension can review configured sites in projects you can access.</p>
        <p className="text-sm text-muted-foreground">Only sites where you choose Start review are activated. Sign-in ends after eight hours or when you restart your browser.</p>
        <form action={approve}><Button type="submit">Sign in to uier</Button></form>
    </main>;
}
