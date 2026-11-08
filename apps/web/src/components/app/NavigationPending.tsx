'use client';

import { useLinkStatus } from 'next/link';
import type { ReactNode } from 'react';
import { Spinner } from '@/src/components/ui/spinner';
import { cn } from '@/src/lib/utils';

/** Links respond at once while Next waits for the authorized destination. */
export function NavigationPending({ children, className }: { children?: ReactNode; className?: string }) {
    const { pending } = useLinkStatus();
    if (children) return pending ? <Spinner className={className} /> : children;
    // Reserve the icon's space so a pending link does not move its neighbours; a hidden one stays still.
    return <Spinner className={cn(className, !pending && 'invisible animate-none')} />;
}
