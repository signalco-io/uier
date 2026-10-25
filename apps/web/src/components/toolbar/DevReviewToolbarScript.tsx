'use client';

import { usePathname } from 'next/navigation';
import { KnownPages } from '../../knownPages';
import { ToolbarScript } from './ToolbarScript';

/**
 * `next dev` only: review mode in the app. The public marketing layout embeds showcase mode.
 */
export function DevReviewToolbarScript() {
    const pathname = usePathname();
    if (!pathname.startsWith(KnownPages.App)) {
        return null;
    }

    return <ToolbarScript mode="review" />;
}
