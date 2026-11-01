'use client';

import { useLinkStatus } from 'next/link';
import type { ReactNode } from 'react';
import { Spinner } from '@/src/components/ui/spinner';

/** Links respond at once while Next waits for the authorized destination. */
export function NavigationPending({ children }: { children?: ReactNode }) {
    const { pending } = useLinkStatus();
    if (children) return pending ? <Spinner /> : children;
    // Reserve the icon's space so a pending link does not move its neighbours.
    return <Spinner className={pending ? undefined : 'invisible'} />;
}
