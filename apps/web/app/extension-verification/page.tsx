import { extensionFrameAncestors } from '@/src/lib/extension/config';
import { ExtensionVerificationBridge } from './VerificationBridge';

/** Server configuration selects the exact extension parent, including per-install UUIDs. */
export default async function ExtensionVerification({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const input = await searchParams;
    const url = new URL('https://uier.invalid/extension-verification');
    for (const key of ['clientId', 'extensionOrigin']) {
        const value = input[key];
        if (value !== undefined) url.searchParams.set(key, typeof value === 'string' ? value : '');
    }
    return <ExtensionVerificationBridge origins={extensionFrameAncestors(url)} clientId={typeof input.clientId === 'string' ? input.clientId : undefined} />;
}
