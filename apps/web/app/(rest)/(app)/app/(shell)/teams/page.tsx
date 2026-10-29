import type { Metadata } from 'next';
import Link from 'next/link';
import { Input } from '@/src/components/ui/input';
import { Button } from '@/src/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { PageHeader, Section } from '@/src/components/app/PageHeader';
import { TeamEditor, CopyAccessToTeam } from '@/src/components/app/teams/AccessForms';
import { requireTeamAdmin, managementData } from '@/src/components/app/teams/management';
import { AccessActivity } from '@/src/components/app/teams/Activity';
import { listTeams, listAccessEvents } from '@/src/lib/app/teams';
import { listInvitations } from '@/src/lib/app/invitations';
import { KnownPages, KnownPageLinks } from '@/src/knownPages';

export const metadata: Metadata = { title: 'Teams' };

export default async function TeamsPage({ searchParams }: PageProps<'/app/teams'>) {
    const context = await requireTeamAdmin(),
        query = await searchParams;
    const text = (key: string) => (typeof query[key] === 'string' ? (query[key] as string) : undefined);
    const state = text('state') === 'archived' ? 'archived' : 'active';
    const [{ teams, next }, data, invitations, history] = await Promise.all([
        listTeams(context.workspace.id, { state, search: text('q'), after: text('after') }),
        managementData(context),
        listInvitations(context.workspace.id),
        listAccessEvents(context.workspace.id, text('activity'))
    ]);
    const nextQuery = new URLSearchParams({ state, q: text('q') ?? '', ...(next ? { after: next } : {}) });
    return (
        <>
            <PageHeader
                title="Teams"
                description="Share selected projects with a group of people."
                actions={<TeamEditor />}
            />
            <div className="flex flex-col gap-8">
                <form className="flex flex-wrap items-end gap-3">
                    <FieldGroup className="w-full sm:w-64">
                        <Field>
                            <FieldLabel htmlFor="team-search">Search teams</FieldLabel>
                            <Input id="team-search" name="q" defaultValue={text('q')} maxLength={80} />
                        </Field>
                    </FieldGroup>
                    <input type="hidden" name="state" value={state} />
                    <Button type="submit" variant="outline">
                        Search
                    </Button>
                    <Link href={`${KnownPages.AppTeams}?state=${state === 'active' ? 'archived' : 'active'}`}>
                        Show {state === 'active' ? 'archived' : 'active'} teams
                    </Link>
                </form>
                <Section
                    id="directory"
                    title={state === 'active' ? 'Active teams' : 'Archived teams'}
                    description="Teams only grant their explicitly selected projects. Archived teams grant no access."
                >
                    {teams.length ? (
                        <ul className="m-0 list-none divide-y rounded-xl border p-0">
                            {teams.map((team) => (
                                <li key={team.id} className="flex flex-col gap-1 p-4">
                                    <Link className="font-medium" href={KnownPageLinks.team(team.id)}>
                                        {team.name}
                                    </Link>
                                    {team.description && (
                                        <p className="m-0 break-words text-sm text-muted-foreground">
                                            {team.description}
                                        </p>
                                    )}
                                    <p className="m-0 text-sm text-muted-foreground">
                                        {team.state === 'active' ? 'Active' : 'Archived'} ·{' '}
                                        {
                                            data.people.filter((person) => person.member.teamIds?.includes(team.id))
                                                .length
                                        }{' '}
                                        accepted people ·{' '}
                                        {
                                            invitations.filter((invitation) => invitation.teamIds?.includes(team.id))
                                                .length
                                        }{' '}
                                        pending invitations · {team.projectIds.length} selected projects
                                    </p>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="rounded-xl border border-dashed p-6">
                            <p className="text-sm text-muted-foreground">
                                No {state} teams{query.q ? ' match this search' : ' yet'}. Create a team, then choose
                                its people and projects.
                            </p>
                            <TeamEditor />
                        </div>
                    )}
                    {next && <Link href={`${KnownPages.AppTeams}?${nextQuery}`}>Next teams page</Link>}
                </Section>
                <Section
                    id="copy-access"
                    title="Create from existing access"
                    description="Choose people and projects explicitly. Their existing direct grants stay."
                >
                    <CopyAccessToTeam data={data} />
                </Section>
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
