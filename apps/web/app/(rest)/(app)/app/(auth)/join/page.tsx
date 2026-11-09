import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { UsersIcon } from 'lucide-react';
import { cn } from 'cn';
import { buttonVariants } from '@/src/components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/src/components/ui/item';
import { AuthCard } from '@/src/components/app/AuthCard';
import { KnownPages } from '@/src/knownPages';
import { getSessionUser } from '@/src/lib/app/session';
import { joinNextPath } from '@/src/lib/app/signInDestination';
import { domainJoinOffers, emailDomain } from '@/src/lib/app/workspaceDomains';
import { JoinWorkspaceForm } from './JoinWorkspaceForm';

export const metadata: Metadata = {
    title: 'Join your team'
};

/**
 * After sign-in, when workspaces are open to the account's email domain (`workspaceDomains.ts`): join one
 * with a click, or continue without joining. Shows only the workspace's name and who added the domain.
 */
export default async function JoinPage({ searchParams }: PageProps<'/app/join'>) {
    const user = await getSessionUser();
    const { next } = await searchParams;
    const destination = joinNextPath(next);
    if (!user)
        redirect(`${KnownPages.AppSignIn}?${new URLSearchParams({ next: KnownPages.AppJoin })}`);
    const offers = await domainJoinOffers(user);
    if (!offers.length)
        redirect(destination);

    const domain = emailDomain(user.email);
    const single = offers.length === 1 ? offers[0]! : undefined;
    return (
        <AuthCard
            title={single ? `Join ${single.workspaceName}` : 'Join your team'}
            description={(
                <>
                    People with an email at <span className="font-medium text-foreground">{domain}</span> can
                    join {single ? 'this workspace' : 'these workspaces'}. You join as a commenter and review the
                    projects its admins share with you.
                </>
            )}>
            <div className="flex flex-col gap-4">
                <ItemGroup aria-label="Workspaces you can join" className="gap-3">
                    {offers.map(offer => (
                        <Item key={offer.workspaceId} variant="outline" role="listitem">
                            <ItemMedia variant="icon"><UsersIcon /></ItemMedia>
                            <ItemContent className="min-w-0">
                                <ItemTitle className="line-clamp-none break-words">{offer.workspaceName}</ItemTitle>
                                {offer.addedByName && <ItemDescription className="line-clamp-none break-words">Set up by {offer.addedByName}</ItemDescription>}
                            </ItemContent>
                            {!single && (
                                <ItemActions>
                                    <JoinWorkspaceForm workspaceId={offer.workspaceId} workspaceName={offer.workspaceName} next={destination} primary={false} />
                                </ItemActions>
                            )}
                        </Item>
                    ))}
                </ItemGroup>
                <div className="flex flex-col gap-3">
                    {single && <JoinWorkspaceForm workspaceId={single.workspaceId} workspaceName={single.workspaceName} next={destination} primary />}
                    <Link href={destination} className={cn(buttonVariants({ variant: 'ghost', size: 'lg' }), 'w-full')}>Not now</Link>
                </div>
            </div>
        </AuthCard>
    );
}
