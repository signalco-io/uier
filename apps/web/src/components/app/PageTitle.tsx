'use client';

import type { ReactNode } from 'react';
import { useViewVisible } from '@/src/hooks/use-view-visible';

/**
 * The page's h1 (`PageHeader`). A page Next keeps hidden after navigating away (Cache Components' Activity), or mounts
 * while hidden, shows its title in a plain block instead, so the visible page keeps the document's only h1 (uier #324).
 */
export function PageTitle({ children, className }: { children: ReactNode; className?: string }) {
    const Heading = useViewVisible({ untilShown: true }) ? 'h1' : 'div';
    return <Heading className={className}>{children}</Heading>;
}
