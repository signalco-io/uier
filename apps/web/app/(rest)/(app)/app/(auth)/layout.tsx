import type { PropsWithChildren } from 'react';
import Link from 'next/link';
import { Logo } from '@uier/brand/Logo';
import { KnownPages } from '@/src/knownPages';

/** Signed-out pages (sign in, invitations): one narrow column */
export default function AuthLayout({ children }: PropsWithChildren) {
    return (
        <main className="flex min-h-full flex-col items-center px-4 py-16 md:py-24">
            <div className="flex w-full max-w-sm flex-col gap-8">
                <Link href={KnownPages.Landing} aria-label="uier home" className="self-start">
                    <Logo size={20} />
                </Link>
                {children}
            </div>
        </main>
    );
}
