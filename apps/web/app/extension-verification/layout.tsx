import type { PropsWithChildren } from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function Layout({ children }: PropsWithChildren) { return children; }
