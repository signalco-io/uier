import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Button } from '@signalco/ui-primitives/Button';
import { People, Settings } from '@signalco/ui-icons';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { requireAppContext } from '@/src/lib/app/context';
import { getVisibleProject, reviewUrl } from '@/src/lib/app/projects';
import { loadProjectComments } from '@/src/lib/app/projectComments';
import { listProjectMembers } from '@/src/lib/app/members';
import { PageHeader, Section } from '@/src/components/app/PageHeader';
import { CopyBlock } from '@/src/components/app/CopyBlock';
import { parseCommentsQuery, ProjectComments } from '@/src/components/app/comments/ProjectComments';
import { ReviewLinksMenu } from '@/src/components/app/projects/ReviewLinksMenu';
import { displayUrl, projectAccessLabels } from '@/src/components/app/projects/projectLabels';

export async function generateMetadata({ params }: PageProps<'/app/projects/[projectId]'>): Promise<Metadata> {
    const { projectId } = await params;
    const context = await requireAppContext();
    const project = await getVisibleProject(context, projectId);
    return { title: project?.name ?? 'Project' };
}

export default async function ProjectPage({ params, searchParams }: PageProps<'/app/projects/[projectId]'>) {
    const { projectId } = await params;
    const context = await requireAppContext();
    const project = await getVisibleProject(context, projectId);
    if (!project)
        notFound();

    const [comments, members] = await Promise.all([
        loadProjectComments(context, project),
        listProjectMembers(context.workspace.id, project.id)
    ]);
    const query = parseCommentsQuery(await searchParams);

    return (
        <>
            <PageHeader
                title={project.name}
                description={(
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-mono">{displayUrl(project.urls[0] ?? '')}</span>
                        <span>{projectAccessLabels[project.access].label}</span>
                        {project.status === 'done' && (
                            <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium text-foreground">
                                <span aria-hidden="true" className="size-1.5 rounded-full bg-[hsl(var(--brand-success))]" />
                                Done
                            </span>
                        )}
                    </span>
                )}
                actions={(
                    <>
                        <ReviewLinksMenu projectId={project.id} urls={project.urls} />
                        {context.isAdmin && (
                            <>
                                <Button href={`${KnownPages.AppInviteUser}?project=${project.id}`} variant="plain" startDecorator={<People className="size-4" />}>
                                    Invite
                                </Button>
                                <Button href={KnownPageLinks.projectSettings(project.id)} variant="plain" startDecorator={<Settings className="size-4" />}>
                                    Settings
                                </Button>
                            </>
                        )}
                    </>
                )} />
            <div className="flex flex-col gap-6">
                {project.access === 'guests' && project.urls[0] && (
                    <Section
                        id="share"
                        title="Guest link"
                        description="Anyone with this link can comment as a guest. They are asked for their name.">
                        <CopyBlock value={reviewUrl(project.urls[0], project.id)} label="Copy the guest link" />
                    </Section>
                )}
                <Section id="comments" title="Comments" description="Comments left on the site with the toolbar.">
                    <ProjectComments
                        projectId={project.id}
                        comments={comments}
                        query={query}
                        userId={context.user.id}
                        assignees={members.map(({ member, name }) => ({ userId: member.userId, name }))} />
                    {!comments.length && (
                        <Button href={KnownPageLinks.projectInstall(project.id)} variant="outlined" className="self-start">Install the script</Button>
                    )}
                </Section>
            </div>
        </>
    );
}
