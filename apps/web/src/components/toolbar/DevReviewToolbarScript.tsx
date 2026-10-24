'use client';

import { usePathname } from 'next/navigation';
import { KnownPages } from '../../knownPages';
import { ToolbarScript } from './ToolbarScript';

/**
 * `next dev` only: the toolbar in review mode (`?review=true`) on every page except the landing
 * page, which embeds it in showcase mode itself.
 */
export function DevReviewToolbarScript() {
    const pathname = usePathname();
    if (pathname === KnownPages.Landing) {
        return null;
    }

    return <ToolbarScript mode="review" />;
}
