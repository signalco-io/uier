import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { getAppContext } from '@/src/lib/app/context';
import { reviewTarget } from '@/src/lib/app/review';

// Only a link that cannot open renders (`not-found.tsx`); the others redirect.
export const metadata: Metadata = {
    title: 'Review link unavailable'
};

/**
 * A review link: `/app/review/<project>?url=<page>&comment=<id>`. Checks that the signed-in person
 * may review the project and sends them to the page with the toolbar turned on (`?toolbar-code=`)
 * and signed in. A link that cannot open renders `not-found.tsx` (404).
 */
export default async function ReviewLinkPage({ params, searchParams }: PageProps<'/app/review/[projectId]'>) {
    const [{ projectId }, query] = await Promise.all([params, searchParams]);
    const url = typeof query.url === 'string' ? query.url : null;
    const comment = typeof query.comment === 'string' ? query.comment : null;

    const context = await getAppContext();
    if (!context)
        redirect(`${KnownPages.AppSignIn}?${new URLSearchParams({ next: KnownPageLinks.projectReview(projectId, url ?? undefined, comment ?? undefined) })}`);

    const target = await reviewTarget(context, projectId, url, comment);
    if (!target)
        notFound();

    redirect(target);
}
