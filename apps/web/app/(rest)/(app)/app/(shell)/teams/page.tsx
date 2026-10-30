import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRightIcon, SearchIcon, UsersIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/src/components/ui/dialog';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/src/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/src/components/ui/input-group';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/src/components/ui/item';
import { PageHeader, Section } from '@/src/components/app/PageHeader';
import { LinkTabs } from '@/src/components/app/LinkTabs';
import { ProjectMark } from '@/src/components/app/projects/ProjectMark';
import { TeamEditor, CopyAccessToTeam } from '@/src/components/app/teams/AccessForms';
import { requireTeamAdmin, managementData } from '@/src/components/app/teams/management';
import { AccessActivity } from '@/src/components/app/teams/Activity';
import { listTeams, listAccessEvents } from '@/src/lib/app/teams';
import { listInvitations } from '@/src/lib/app/invitations';
import { KnownPages, KnownPageLinks } from '@/src/knownPages';

export const metadata: Metadata = { title: 'Teams' };

/** "3 people, 1 invited, 2 projects" */
function countsText(people: number, invited: number, projects: number) {
    return [
        `${people} ${people === 1 ? 'person' : 'people'}`,
        invited && `${invited} invited`,
        `${projects} ${projects === 1 ? 'project' : 'projects'}`
    ].filter(Boolean).join(', ');
}

/** The workspace's teams (active or archived, searchable), creating one, and the access history */
export default async function TeamsPage({ searchParams }: PageProps<'/app/teams'>) {
    const context = await requireTeamAdmin(),
        query = await searchParams;
    const text = (key: string) => (typeof query[key] === 'string' ? (query[key] as string) : undefined);
    const state = text('state') === 'archived' ? 'archived' : 'active';
    const search = text('q')?.trim() || undefined;
    const [{ teams, next }, data, invitations, history] = await Promise.all([
        listTeams(context.workspace.id, { state, search, after: text('after') }),
        managementData(context),
        listInvitations(context.workspace.id),
        listAccessEvents(context.workspace.id, text('activity'))
    ]);
    const stateHref = (value: 'active' | 'archived') => {
        const params = new URLSearchParams();
        if (value === 'archived') params.set('state', value);
        if (search) params.set('q', search);
        return `${KnownPages.AppTeams}${params.size ? `?${params}` : ''}`;
    };
    const nextQuery = new URLSearchParams({ state, q: search ?? '', ...(next ? { after: next } : {}) });
    return (
        <>
            <PageHeader
                title="Teams"
                description="Share selected projects with a group of people. Archived teams grant no access."
                actions={(
                    <>
                        {/* A team from people and projects that already have access: an occasional, longer flow */}
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button variant="outline">From existing access</Button>
                            </DialogTrigger>
                            <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
                                <DialogHeader>
                                    <DialogTitle>Create from existing access</DialogTitle>
                                    <DialogDescription>Choose people and projects explicitly. Their existing direct grants stay.</DialogDescription>
                                </DialogHeader>
                                <CopyAccessToTeam data={data} />
                            </DialogContent>
                        </Dialog>
                        {/* The empty active list has its own Create team */}
                        {(teams.length > 0 || state === 'archived' || search) && <TeamEditor />}
                    </>
                )}>
                <div className="flex flex-wrap items-center gap-3">
                    <LinkTabs
                        label="Team status"
                        variant="segmented"
                        tabs={[
                            { href: stateHref('active'), label: 'Active', current: state === 'active' },
                            { href: stateHref('archived'), label: 'Archived', current: state === 'archived' }
                        ]} />
                    {/* Searches the selected tab; Enter submits */}
                    <form role="search" className="w-full sm:w-64">
                        {state === 'archived' && <input type="hidden" name="state" value={state} />}
                        <InputGroup className="h-8">
                            <InputGroupAddon><SearchIcon aria-hidden="true" /></InputGroupAddon>
                            <InputGroupInput type="search" name="q" defaultValue={search} maxLength={80}
                                aria-label="Search teams" placeholder="Search teams" />
                        </InputGroup>
                    </form>
                </div>
            </PageHeader>
            <div className="flex flex-col gap-8">
                {teams.length ? (
                    <div className="flex flex-col gap-3">
                        <Card className="gap-0 py-0">
                            <ItemGroup aria-label={state === 'active' ? 'Active teams' : 'Archived teams'} className="gap-0 divide-y">
                                {teams.map(team => {
                                    const people = data.people.filter(person => person.member.teamIds?.includes(team.id)).length;
                                    const invited = invitations.filter(invitation => invitation.teamIds?.includes(team.id)).length;
                                    return (
                                        <div key={team.id} role="listitem">
                                            <Item asChild className="rounded-none">
                                                <Link href={KnownPageLinks.team(team.id)}>
                                                    <ItemMedia className="group-has-data-[slot=item-description]/item:translate-y-0 group-has-data-[slot=item-description]/item:self-center">
                                                        <ProjectMark name={team.name} className="size-8 rounded-lg text-sm" />
                                                    </ItemMedia>
                                                    <ItemContent className="min-w-0">
                                                        <ItemTitle className="max-w-full break-words">{team.name}</ItemTitle>
                                                        {team.description && <ItemDescription className="truncate">{team.description}</ItemDescription>}
                                                    </ItemContent>
                                                    <ItemActions className="ml-auto text-sm text-muted-foreground tabular-nums">
                                                        {countsText(people, invited, team.projectIds.length)}
                                                        <ChevronRightIcon aria-hidden="true" className="size-4" />
                                                    </ItemActions>
                                                </Link>
                                            </Item>
                                        </div>
                                    );
                                })}
                            </ItemGroup>
                        </Card>
                        {next && (
                            <Button variant="outline" size="sm" asChild className="self-center">
                                <Link href={`${KnownPages.AppTeams}?${nextQuery}`}>Next teams page</Link>
                            </Button>
                        )}
                    </div>
                ) : (
                    <Empty className="border">
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <UsersIcon />
                            </EmptyMedia>
                            <EmptyTitle>
                                {search ? 'No teams match this search' : state === 'archived' ? 'No archived teams' : 'No teams yet'}
                            </EmptyTitle>
                            <EmptyDescription>
                                {search
                                    ? 'Try another name, or look in the other tab.'
                                    : state === 'archived'
                                        ? 'Teams you archive move here. They grant no access until you restore them.'
                                        : 'A team shares the projects you choose with a group of people. Create one, then add its people and projects.'}
                            </EmptyDescription>
                        </EmptyHeader>
                        {state === 'active' && !search && (
                            <EmptyContent>
                                <TeamEditor />
                            </EmptyContent>
                        )}
                    </Empty>
                )}
                <Section id="activity" title="Activity">
                    <AccessActivity
                        events={history.events}
                        names={new Map(data.people.map((person) => [person.member.userId, person.name]))}
                        next={
                            history.next
                                ? `${KnownPages.AppTeams}?${new URLSearchParams({ state, activity: history.next })}#activity`
                                : undefined
                        }
                    />
                </Section>
            </div>
        </>
    );
}
