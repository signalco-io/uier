import type { PropsWithChildren } from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = { robots: { index: false, follow: false } };

// Next can only apply the request CSP nonce when this bridge renders per request.
export const dynamic = 'force-dynamic';

export default function VerificationLayout({ children }: PropsWithChildren) {
    return children;
}
