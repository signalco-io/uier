import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, Section } from '@/src/components/app/PageHeader';
import { BulkTeamForm, TeamEditor, TeamLifecycle, TeamProjectForm } from '@/src/components/app/teams/AccessForms';
import { AccessActivity } from '@/src/components/app/teams/Activity';
import { requireTeamAdmin, managementData } from '@/src/components/app/teams/management';
import { InviteButton } from '@/src/components/app/users/InviteDialog';
import { getTeam, listAccessEvents } from '@/src/lib/app/teams';
import { listInvitations } from '@/src/lib/app/invitations';
import { KnownPageLinks } from '@/src/knownPages';

export const metadata: Metadata = { title: 'Team' };

export default async function TeamPage({ params, searchParams }: PageProps<'/app/teams/[teamId]'>) {
    const context = await requireTeamAdmin(),
        { teamId } = await params;
    const team = (await getTeam(context.workspace.id, teamId))?.doc;
    if (!team) notFound();
    const query = await searchParams;
    const [data, invitations, history] = await Promise.all([
        managementData(context),
        listInvitations(context.workspace.id),
        listAccessEvents(context.workspace.id, typeof query.activity === 'string' ? query.activity : undefined, team.id)
    ]);
    const members = data.people.filter((person) => person.member.teamIds?.includes(team.id));
    const pending = invitations.filter((invitation) => invitation.teamIds?.includes(team.id));
    return (
        <>
            <PageHeader
                title={team.name}
                description={team.description ?? 'Selected people and projects in this workspace.'}
                actions={<TeamEditor team={team} />}
            />
            <div className="flex flex-col gap-8">
                <p className="m-0 text-sm text-muted-foreground">
                    {team.state === 'archived' ? 'Archived · No projects are granted.' : 'Active'}
                </p>
                <Section
                    id="people"
                    title="People"
                    description="Accepted workspace members and pending invitations are separate."
                    actions={team.state === 'active' ? <InviteButton teamId={team.id} /> : undefined}
                >
                    <ul className="m-0 list-none divide-y rounded-xl border p-0">
                        {members.map((person) => (
                            <li className="p-4 text-sm" key={person.member.id}>
                                <Link href={KnownPageLinks.member(person.member.userId)}>{person.name}</Link> ·{' '}
                                {person.member.relationship ?? 'Unspecified'} · {person.member.role}
                            </li>
                        ))}
                    </ul>
                    {!members.length && <p className="text-sm text-muted-foreground">No accepted people yet.</p>}
                    <h3 className="text-sm font-medium">Pending invitations</h3>
                    {pending.length ? (
                        <ul className="text-sm">
                            {pending.map((invitation) => (
                                <li key={invitation.id}>{invitation.email}</li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-muted-foreground">No pending invitations.</p>
                    )}
                    {team.state === 'active' && <BulkTeamForm data={data} fromTeamId={team.id} />}
                </Section>
                <Section
                    id="projects"
                    title="Projects"
                    description="Projects are never copied into a person's direct grants."
                >
                    {team.state === 'active' ? (
                        <TeamProjectForm key={team.updatedAt} team={team} data={data} />
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            Restore this team to select projects again. Restoration starts empty.
                        </p>
                    )}
                </Section>
                <Section id="lifecycle" title="Team state">
                    <TeamLifecycle team={team} data={data} />
                </Section>
                <Section id="activity" title="Activity">
                    <AccessActivity
                        events={history.events}
                        names={new Map(data.people.map((person) => [person.member.userId, person.name]))}
                        next={
                            history.next
                                ? `${KnownPageLinks.team(team.id)}?activity=${encodeURIComponent(history.next)}#activity`
                                : undefined
                        }
                    />
                </Section>
            </div>
        </>
    );
}
