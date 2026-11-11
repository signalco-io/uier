
import { getAppI18n } from '@/src/lib/i18n/server';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LogInIcon, UsersIcon } from 'lucide-react';
import { cn } from 'cn';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@/src/components/ui/item';
import { AuthCard } from '@/src/components/app/AuthCard';
import { signInAgainWithEmailAction } from '@/src/components/app/shell/actions';
import { KnownPages } from '@/src/knownPages';
import { freshlyProvenEmail } from '@/src/lib/app/emailProof';
import { getSessionEmailProof, getSessionUser } from '@/src/lib/app/session';
import { joinNextPath } from '@/src/lib/app/signInDestination';
import { domainJoinOffers, emailDomain } from '@/src/lib/app/workspaceDomains';
import { JoinWorkspaceForm } from './JoinWorkspaceForm';

export const metadata: Metadata = {
    title: 'Join your team'
};

/**
 * After a sign-in that proved the account's email, when workspaces are open to its domain (`workspaceDomains.ts`):
 * join one with a click, or continue without joining. Shows only each workspace's name. Without a fresh email
 * proof (`emailProof.ts`: a passkey sign-in, or the 10 minutes ran out on this page, which a failed Join
 * refreshes) it looks nothing up and offers to sign in again with the email, the same whether or not a
 * workspace matches.
 */
export default async function JoinPage({ searchParams }: PageProps<'/app/join'>) {
    const { t, language } = await getAppI18n();
    const user = await getSessionUser();
    const { next } = await searchParams;
    const destination = joinNextPath(next);
    if (!user)
        redirect(`${KnownPages.AppSignIn}?${new URLSearchParams({ next: KnownPages.AppJoin })}`);
    const proof = await getSessionEmailProof(user);
    if (!freshlyProvenEmail(user.email, proof))
        return (
            <AuthCard
                title={t("Join your team")}
                description={t("To see the workspaces open to your email domain, sign in again with your email. Joining needs a sign-in from the last 10 minutes that confirms your email address.")}>
                <div className="flex flex-col gap-3">
                    <form action={signInAgainWithEmailAction}>
                        <input type="hidden" name="next" value={`${KnownPages.AppJoin}?${new URLSearchParams({ next: destination })}`} />
                        <Button type="submit" size="lg" className="w-full">
                            <LogInIcon data-icon="inline-start" />
                            {t("Sign in again")}{' '}</Button>
                    </form>
                    <Link href={destination} className={cn(buttonVariants({ variant: 'ghost', size: 'lg' }), 'w-full')}>{t("Not now")}</Link>
                </div>
            </AuthCard>
        );
    const offers = await domainJoinOffers(user, proof);
    if (!offers.length)
        redirect(destination);

    const domain = emailDomain(user.email);
    const single = offers.length === 1 ? offers[0]! : undefined;
    return (
        <AuthCard
            title={single ? t("Join {value1}", { value1: single.workspaceName }) : t("Join your team")}
            description={(
                <>
                    {t("People with an email at")}{' '}<span className="font-medium text-foreground">{domain}</span> {t("can join")}{' '}{single ? t("this workspace") : t("these workspaces")}{t(". You join as a commenter and review the projects its admins share with you.")}{' '}</>
            )}>
            <div className="flex flex-col gap-4">
                <ItemGroup aria-label={t("Workspaces you can join")} className="gap-3">
                    {offers.map(offer => (
                        <Item key={offer.workspaceId} variant="outline" role="listitem">
                            <ItemMedia variant="icon"><UsersIcon /></ItemMedia>
                            <ItemContent className="min-w-0">
                                <ItemTitle className="line-clamp-none break-words">{offer.workspaceName}</ItemTitle>
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
                    <Link href={destination} className={cn(buttonVariants({ variant: 'ghost', size: 'lg' }), 'w-full')}>{t("Not now")}</Link>
                </div>
            </div>
        </AuthCard>
    );
}
