import Link from 'next/link';
import { buttonVariants } from '@/src/components/ui/button';
import { StatusPage } from '@/src/components/StatusPage';
import { KnownPages } from '@/src/knownPages';
import { getSessionUser } from '@/src/lib/app/session';
import { AnotherAccountLink } from './AnotherAccountLink';

/**
 * A review link that cannot open: the project or comment is gone, the comment's site address was
 * removed, or the person has no access. Says which account is signed in, since another one may have access.
 */
export default async function ReviewLinkUnavailable() {
    const user = await getSessionUser();
    return (
        <StatusPage
            code="404"
            title="This review link is unavailable"
            note="Nothing to open here."
            description={(
                <>
                    The project or comment may be gone, its original site address may have been removed, or you may no longer have access.
                    {user && <span className="mt-2 block">You are signed in as <span className="inline-block font-medium text-foreground">{user.email}</span>.</span>}
                </>
            )}
            actions={(
                <>
                    <Link href={KnownPages.AppProjects} className={buttonVariants({ size: 'lg' })}>Open your projects</Link>
                    <AnotherAccountLink />
                </>
            )} />
    );
}
