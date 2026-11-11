import type { PropsWithChildren } from 'react';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { connection } from 'next/server';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function VerificationLayout({ children }: PropsWithChildren) {
    return <>{children}<Suspense><RequestScripts /></Suspense></>;
}

// Keep BotID's Next client instrumentation while giving resume scripts the request CSP nonce.
async function RequestScripts() {
    await connection();
    return null;
}
