import type { PropsWithChildren } from 'react';
import { AppBoundary } from '@/src/components/app/AppBoundary';
import { AuthFrame } from '@/src/components/app/AuthFrame';
import { signInOutline } from '@/src/components/app/signInOutline';

/**
 * Pages outside the app shell (sign in, invitations, the browser extension's sign-in): one card in the middle of the
 * page. The frame with an outline of the card is their static shell; the sign-in card is its shape, since most
 * arrivals here are to sign in.
 */
export default function AuthLayout({ children }: PropsWithChildren) {
    return <AppBoundary fallback={<AuthFrame loading {...signInOutline} />}><AuthFrame>{children}</AuthFrame></AppBoundary>;
}
