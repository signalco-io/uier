import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar, AvatarFallback } from '@/src/components/ui/avatar';
import { Badge } from '@/src/components/ui/badge';
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@/src/components/ui/item';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/src/components/ui/empty';
import { PageHeader, Section } from '@/src/components/app/PageHeader';
import { requireTeamAdmin, managementData } from '@/src/components/app/teams/management';
import { MemberAccessForm } from '@/src/components/app/teams/AccessForms';
import { ProjectMark } from '@/src/components/app/projects/ProjectMark';
import { RelativeTime } from '@/src/components/app/comments/DateTime';
import { initials } from '@/src/components/app/initials';
import { projectAccessSources } from '@/src/lib/app/access';
import { KnownPageLinks } from '@/src/knownPages';

export const metadata: Metadata = { title: 'Person access' };

/** Internal or External; nothing while unspecified (as on the users list) */
const relationshipLabels: Record<string, string> = { internal: 'Internal', external: 'External' };

/** Someone in the workspace: who they are, the projects they can review (and why), then their teams and direct access */
export default async function PersonPage({ params }: PageProps<'/app/users/[userId]'>) {
    const context = await requireTeamAdmin(),
        { userId } = await params;
    const data = await managementData(context),
        person = data.people.find((person) => person.member.userId === userId);
    if (!person) notFound();
    const { member } = person;
    const projects = data.projects.flatMap((project) => {
        const sources = projectAccessSources(data.access, member, project);
        return sources.length ? [{ project, sources }] : [];
    });

    return (
        <>
            <PageHeader
                title={(
                    <span className="flex items-center gap-3">
                        <Avatar aria-hidden="true" className="size-9">
                            <AvatarFallback>{initials(person.name)}</AvatarFallback>
                        </Avatar>
                        <span className="min-w-0">{person.name}</span>
                    </span>
                )}
                description={(
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-mono text-[13px]">{member.email}</span>
                        <Badge variant={member.role === 'admin' ? 'default' : 'secondary'}>{member.role === 'admin' ? 'Admin' : 'Commenter'}</Badge>
                        {member.relationship && relationshipLabels[member.relationship] && <Badge variant="outline">{relationshipLabels[member.relationship]}</Badge>}
                        <span>Joined <RelativeTime value={member.createdAt} /></span>
                    </span>
                )} />
            <div className="flex flex-col gap-8">
                <Section
                    id="effective-access"
                    title="Project access"
                    description="What they can review now, and why. Grants add together.">
                    {projects.length ? (
                        <ItemGroup aria-label="Projects" className="gap-0 divide-y rounded-lg border">
                            {projects.map(({ project, sources }) => (
                                <Item key={project.id} role="listitem" className="rounded-none">
                                    <ItemMedia>
                                        <ProjectMark name={project.name} url={project.urls[0]} className="size-8 rounded-lg text-sm [&>img]:p-1.5" />
                                    </ItemMedia>
                                    <ItemContent className="min-w-0">
                                        <ItemTitle>
                                            <Link href={KnownPageLinks.project(project.id)} className="underline-offset-4 hover:underline">{project.name}</Link>
                                        </ItemTitle>
                                        {/* Every source of access, so removing one shows what still grants it */}
                                        <div className="flex flex-wrap gap-1">
                                            {sources.map(source => <Badge key={source} variant="outline" className="font-normal text-muted-foreground">{source}</Badge>)}
                                        </div>
                                    </ItemContent>
                                </Item>
                            ))}
                        </ItemGroup>
                    ) : (
                        <Empty className="border">
                            <EmptyHeader>
                                <EmptyTitle>No project access</EmptyTitle>
                                <EmptyDescription>Add them to a team or give them direct access below.</EmptyDescription>
                            </EmptyHeader>
                        </Empty>
                    )}
                </Section>
                <MemberAccessForm key={data.revision} person={person} data={data} />
            </div>
        </>
    );
}
