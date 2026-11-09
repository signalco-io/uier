import type { Metadata } from 'next';
import { Logo } from '@uier/brand/Logo';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Extension sign-in', robots: { index: false, follow: false } };

/** Safari observes this exact first-party tab URL. No credentials or codes enter the page. */
export default function ExtensionCallback() {
    return <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
        <Logo className="h-8" />
        <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight">Return to the extension</h1>
            <p className="text-sm text-muted-foreground">uier is finishing your sign-in. You can close this tab.</p>
        </div>
    </main>;
}
