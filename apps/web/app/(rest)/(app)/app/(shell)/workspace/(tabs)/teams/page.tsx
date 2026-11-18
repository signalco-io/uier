
import { pluralText } from '@/src/components/app/teams/pluralText';
import type { AppTranslator } from '@/src/lib/i18n/types';
import { getAppI18n } from '@/src/lib/i18n/server';
import { cache, Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRightIcon, UsersIcon } from 'lucide-react';
import { cn } from 'cn';
import { buttonVariants } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/src/components/ui/empty';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/src/components/ui/item';
import { TeamsToolbar } from '@/src/components/app/workspace/TeamsToolbar';
import { GroupPeopleLoading, TeamsLoading } from '@/src/components/app/workspace/WorkspaceLoading';
import { ProjectMark } from '@/src/components/app/projects/ProjectMark';
import { CopyAccessToTeam } from '@/src/components/app/teams/CopyAccessToTeam';
import { requireTeamAdmin, managementData } from '@/src/components/app/teams/management';
import { listTeams } from '@/src/lib/app/teams';
import { listInvitations } from '@/src/lib/app/invitations';
import { KnownPages, KnownPageLinks } from '@/src/knownPages';

export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getAppI18n();
    return { title: t("Teams") };
}

/** "3 people, 1 invited, 2 projects" */
function countsText(people: number, invited: number, projects: number, t: AppTranslator, language: string) {
    return [
        pluralText(t, language, people, '{count} person', '{count} people'),
        invited && t('{count} invited', { count: invited }),
        pluralText(t, language, projects, '{count} project', '{count} projects')
    ].filter(Boolean).join(', ');
}

/**
 * The workspace's people, projects and access, read once in a render for both of the page's boundaries: the list
 * (how many people each team has) and the body of Group existing people. Each caller authorizes through it.
 */
const workspaceManagement = cache(async () => managementData(await requireTeamAdmin()));

/** The body of Group existing people: the people already in the workspace and its projects to choose from */
async function GroupPeople() {
    return <CopyAccessToTeam data={await workspaceManagement()} />;
}

/** The teams of the chosen status that match the search, a page at a time; the access history is the Activity tab */
async function Teams({ searchParams }: PageProps<'/app/workspace/teams'>) {
    const { t, language } = await getAppI18n();
    const context = await requireTeamAdmin(),
        query = await searchParams;
    const text = (key: string) => (typeof query[key] === 'string' ? (query[key] as string) : undefined);
    const state = text('state') === 'archived' ? 'archived' : 'active';
    const search = text('q')?.trim() || undefined;
    const [{ teams, next }, data, invitations] = await Promise.all([
        listTeams(context.workspace.id, { state, search, after: text('after') }),
        workspaceManagement(),
        listInvitations(context.workspace.id)
    ]);
    const nextQuery = new URLSearchParams({ state, q: search ?? '', ...(next ? { after: next } : {}) });
    if (!teams.length) {
        return (
            <Empty className="border">
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <UsersIcon />
                    </EmptyMedia>
                    <EmptyTitle>
                        {search ? t("No teams match this search") : state === 'archived' ? t("No archived teams") : t("No teams yet")}
                    </EmptyTitle>
                    <EmptyDescription>
                        {search
                            ? t("Try another name, or look in the other tab.")
                            : state === 'archived'
                                ? t("Teams you archive move here. They grant no access until you restore them.")
                                : t("A team shares the projects you choose with a group of people. Create a team, then add its people and projects.")}
                    </EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    }
    return (
        <div className="flex flex-col gap-3">
            <Card className="gap-0 py-0">
                <ItemGroup aria-label={state === 'active' ? t("Active teams") : t("Archived teams")} className="gap-0 divide-y">
                    {teams.map(team => {
                        const people = data.people.filter(person => person.member.teamIds?.includes(team.id)).length;
                        const invited = invitations.filter(invitation => invitation.teamIds?.includes(team.id)).length;
                        return (
                            <div key={team.id} role="listitem">
                                <Item className="rounded-none" render={<Link href={KnownPageLinks.team(team.id)} />}>
                                    <ItemMedia className="group-has-data-[slot=item-description]/item:translate-y-0 group-has-data-[slot=item-description]/item:self-center">
                                        <ProjectMark name={team.name} className="size-8 rounded-lg text-sm" />
                                    </ItemMedia>
                                    <ItemContent className="min-w-0">
                                        <ItemTitle className="max-w-full break-words">{team.name}</ItemTitle>
                                        {team.description && <ItemDescription className="truncate">{team.description}</ItemDescription>}
                                    </ItemContent>
                                    <ItemActions className="ml-auto text-sm text-muted-foreground tabular-nums">
                                        {countsText(people, invited, team.projectIds.length, t, language)}
                                        <ChevronRightIcon aria-hidden="true" className="size-4" />
                                    </ItemActions>
                                </Item>
                            </div>
                        );
                    })}
                </ItemGroup>
            </Card>
            {next && (
                <Link href={`${KnownPages.AppTeams}?${nextQuery}`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'self-center')}>{t("Next teams page")}</Link>
            )}
        </div>
    );
}

/**
 * The workspace's teams (active or archived, searchable) and creating one. The toolbar follows the address alone, so
 * it is outside the data boundaries: real at once, and it stays while the list loads under it. The list and the body
 * of Group existing people each stream in their own boundary, from one read of the workspace.
 */
export default function TeamsPage(props: PageProps<'/app/workspace/teams'>) {
    return (
        <>
            <TeamsToolbar group={<Suspense fallback={<GroupPeopleLoading />}><GroupPeople /></Suspense>} />
            <div className="flex flex-col gap-8">
                <Suspense fallback={<TeamsLoading />}><Teams {...props} /></Suspense>
            </div>
        </>
    );
}
