import Link from 'next/link';
import type { AppContext } from '@/src/lib/app/context';
import type { DbProject } from '@/src/lib/app/model';
import { projectAccessSources } from '@/src/lib/app/access';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { Button } from '@/src/components/ui/button';
import { Section } from '../PageHeader';
import { managementData } from './management';
import { ProjectTeamButton, RemoveProjectAccess } from './AccessForms';

export async function ProjectPeopleAndTeams({ context, project }: { context: AppContext; project: DbProject }) {
    const data = await managementData(context);
    return (
        <Section
            id="people-and-teams"
            title="People and teams"
            description="Managed member access is separate from Who can comment."
            actions={(
                // Teams and people are managed for the whole workspace on their own pages
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" asChild><Link href={KnownPages.AppTeams}>Manage teams</Link></Button>
                    <Button variant="outline" size="sm" asChild><Link href={KnownPages.AppUsers}>Manage users</Link></Button>
                </div>
            )}
        >
            {project.access === 'guests' && (
                <p className="text-sm text-muted-foreground">
                    Guest links remain allowed. Removing a person or team only removes managed member access.
                </p>
            )}
            <h3 className="text-sm font-medium">Teams</h3>
            <ul className="m-0 list-none divide-y rounded-xl border p-0">
                {data.access.teams.map((team) => {
                    const people = data.people.filter((person) => person.member.teamIds?.includes(team.id));
                    return (
                        <li key={team.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                            <div>
                                <Link href={KnownPageLinks.team(team.id)}>{team.name}</Link>
                                <p className="m-0 text-muted-foreground">
                                    {people.length} people ·{' '}
                                    {people.filter((person) => person.member.relationship === 'external').length}{' '}
                                    external ·{' '}
                                    {team.projectIds.includes(project.id)
                                        ? 'Grants this project'
                                        : 'No grant for this project'}
                                </p>
                            </div>
                            <ProjectTeamButton team={team} project={project} data={data} />
                        </li>
                    );
                })}
            </ul>
            <h3 className="text-sm font-medium">People with effective access</h3>
            <ul className="m-0 list-none divide-y rounded-xl border p-0">
                {data.people.flatMap((person) => {
                    const sources = projectAccessSources(data.access, person.member, project);
                    return sources.length
                        ? [
                              <li key={person.member.id} className="flex flex-col gap-3 p-4 text-sm">
                                  <Link href={KnownPageLinks.member(person.member.userId)}>{person.name}</Link>
                                  <p className="m-0 text-muted-foreground">{sources.join('; ')}</p>
                                  <RemoveProjectAccess person={person} project={project} data={data} />
                              </li>
                          ]
                        : [];
                })}
            </ul>
        </Section>
    );
}
