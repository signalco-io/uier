import { Suspense, type ReactNode } from 'react';
import type { Metadata } from 'next';
import "./proof.css";
import { AppLanguage } from '@/src/components/app/AppLanguage';

export const metadata: Metadata = {
    title: 'File review',
    robots: { index: false, follow: false },
    referrer: 'no-referrer'
};

export default function ProofLayout({ children }: { children: ReactNode }) {
    return <Suspense fallback={<div className="min-h-dvh bg-background" />}><AppLanguage>{children}</AppLanguage></Suspense>;
}
