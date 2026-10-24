import { PropsWithChildren } from 'react';
import type { Metadata } from 'next';

// The app (signed in or signing in) is not for search engines
export const metadata: Metadata = {
    robots: { index: false, follow: false }
};

export default function RootLayout({ children }: PropsWithChildren) {
    return (
        <>
            <div className="md:h-full">
                {children}
            </div>
        </>
    );
}
