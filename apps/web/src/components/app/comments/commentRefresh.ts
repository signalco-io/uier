'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export const COMMENT_REFRESH_EVENT = 'uier:comments-refresh';

/** Notify only after the write succeeds; failed transitions retain their normal rollback. */
export function refreshCommentsAfter<Args extends unknown[], Result>(action: (...args: Args) => Promise<Result>) {
    return async (...args: Args): Promise<Result> => {
        const result = await action(...args);
        if (result && typeof result === 'object' && 'ok' in result && result.ok)
            window.dispatchEvent(new CustomEvent(COMMENT_REFRESH_EVENT, { detail: typeof args[0] === 'string' ? args[0] : (args[0] as { projectId?: string })?.projectId }));
        return result;
    };
}

/** My work still owns an RSC snapshot; the project inbox handles this event with its pager. */
export function useMyWorkCommentRefresh() {
    const router = useRouter();
    useEffect(() => {
        const refresh = () => router.refresh();
        window.addEventListener(COMMENT_REFRESH_EVENT, refresh);
        return () => window.removeEventListener(COMMENT_REFRESH_EVENT, refresh);
    }, [router]);
}
