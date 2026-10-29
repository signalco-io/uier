import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader, Section } from '@/src/components/app/PageHeader';
import { requireTeamAdmin, managementData } from '@/src/components/app/teams/management';
import { MemberAccessForm } from '@/src/components/app/teams/AccessForms';
import { projectAccessSources } from '@/src/lib/app/access';

export const metadata: Metadata = { title: 'Person access' };
export default async function PersonPage({ params }: PageProps<'/app/users/[userId]'>) {
    const context = await requireTeamAdmin(),
        { userId } = await params;
    const data = await managementData(context),
        person = data.people.find((person) => person.member.userId === userId);
    if (!person) notFound();
    return (
        <>
            <PageHeader
                title={person.name}
                description={`${person.member.role === 'admin' ? 'Workspace admin' : 'Commenter'} · ${person.member.relationship ?? 'Unspecified'}`}
            />
            <div className="flex flex-col gap-8">
                <Section
                    id="effective-access"
                    title="Effective access"
                    description="Every current source is listed. Grants add together."
                >
                    <ul className="m-0 list-none divide-y rounded-xl border p-0">
                        {data.projects.flatMap((project) => {
                            const reasons = projectAccessSources(data.access, person.member, project);
                            return reasons.length
                                ? [
                                      <li key={project.id} className="p-4 text-sm">
                                          {project.name}
                                          <p className="m-0 text-muted-foreground">{reasons.join('; ')}</p>
                                      </li>
                                  ]
                                : [];
                        })}
                    </ul>
                </Section>
                <Section id="edit-access" title="Teams and direct grants">
                    <MemberAccessForm key={data.revision} person={person} data={data} />
                </Section>
            </div>
        </>
    );
}
