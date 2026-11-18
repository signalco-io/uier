import type { PropsWithChildren } from 'react';
import { AppBoundary } from '@/src/components/app/AppBoundary';
import { AuthFrame } from '@/src/components/app/AuthFrame';
import { getSessionUser } from '@/src/lib/app/session';
import { AccountSessionBoundary } from '@/src/components/app/shell/AccountSessionBoundary';

/** A coding tool's sign-in (consent and its errors): one focused card, without the app sidebar */
async function ConnectLayoutContent({ children }: PropsWithChildren) {
    const user = await getSessionUser();
    return (
        <>
            <AccountSessionBoundary userId={user?.id ?? null} reloadOnChange />
            <AuthFrame wide>{children}</AuthFrame>
        </>
    );
}

export default function ConnectLayout(props: Parameters<typeof ConnectLayoutContent>[0]) {
    // The card's frame is the static shell, also when the app is left for it
    return <AppBoundary fallback={<AuthFrame wide loading actions={2} />}><ConnectLayoutContent {...props} /></AppBoundary>;
}
