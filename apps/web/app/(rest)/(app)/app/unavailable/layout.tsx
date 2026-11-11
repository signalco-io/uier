import type { PropsWithChildren } from 'react';

export const metadata = { title: 'Page not found' };

export default function UnavailableLayout({ children }: PropsWithChildren) {
    return children;
}
