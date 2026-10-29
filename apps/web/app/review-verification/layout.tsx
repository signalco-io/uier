import type { PropsWithChildren } from 'react';

// Next can only apply the request CSP nonce when this bridge renders per request.
export const dynamic = 'force-dynamic';

export default function VerificationLayout({ children }: PropsWithChildren) {
    return children;
}
