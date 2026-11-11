import { extensionFrameAncestors } from '@/src/lib/extension/config';
import { ExtensionVerificationBridge } from './VerificationBridge';
import { Suspense } from 'react';

/** Server configuration selects the exact extension parent, including per-install UUIDs. */
async function ExtensionVerificationContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const input = await searchParams;
    const url = new URL('https://uier.invalid/extension-verification');
    for (const key of ['clientId', 'extensionOrigin']) {
        const value = input[key];
        if (value !== undefined) url.searchParams.set(key, typeof value === 'string' ? value : '');
    }
    return <ExtensionVerificationBridge origins={extensionFrameAncestors(url)} clientId={typeof input.clientId === 'string' ? input.clientId : undefined} />;
}

export default function ExtensionVerification(props: Parameters<typeof ExtensionVerificationContent>[0]) {
    return <Suspense fallback={<p>Verifying your browser for uier.</p>}><ExtensionVerificationContent {...props} /></Suspense>;
}
