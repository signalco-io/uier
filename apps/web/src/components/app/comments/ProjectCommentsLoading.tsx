import { Suspense } from 'react';
import { getCommentsView } from '@/src/lib/app/commentsViewCookie';
import { AddressCommentsLoading, CommentsLoading } from './CommentsLoading';

/** The view remembered in the request's cookie, read under its own boundary so the prefetched shell stays static */
async function RememberedCommentsLoading({ title }: { title?: string }) {
    return <AddressCommentsLoading title={title} remembered={await getCommentsView()} />;
}

/**
 * A project's comments while they load, in the view they will open in (uier #362). The prefetched shell has this
 * browser's guess (`CommentsLoading`); the request then answers with the address's view (`?view=board`) or the
 * remembered one before any comment is read, on a full load and a navigation alike (`AddressCommentsLoading`). Usable
 * in a layout's fallback too: the address comes from the router, not the page's `searchParams`.
 */
export function ProjectCommentsLoading({ title }: { title?: string }) {
    return (
        <Suspense fallback={<CommentsLoading title={title} />}>
            <RememberedCommentsLoading title={title} />
        </Suspense>
    );
}
