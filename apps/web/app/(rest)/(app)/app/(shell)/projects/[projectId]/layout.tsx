import { notFound } from 'next/navigation';
import { Badge } from '@/src/components/ui/badge';
import { KnownPageLinks } from '@/src/knownPages';
import { requireAppContext } from '@/src/lib/app/context';
import { getVisibleProject } from '@/src/lib/app/projects';
import { clientSummary, getClient } from '@/src/lib/app/clients';
import { PageHeader } from '@/src/components/app/PageHeader';
import { LinkTabs } from '@/src/components/app/LinkTabs';
import { ProjectMark } from '@/src/components/app/projects/ProjectMark';
import { ClientMark } from '@/src/components/app/clients/ClientMark';
import { ReviewLinksMenu } from '@/src/components/app/projects/ReviewLinksMenu';
import { InviteButton } from '@/src/components/app/users/InviteDialog';
import { displayUrl } from '@/src/components/app/projects/projectLabels';
import { ProjectAccessInfo } from '@/src/components/app/projects/ProjectAccessInfo';
import { GuestReviewLinks } from '@/src/components/app/projects/GuestReviewLinks';

/** A project: its name, sites and review actions, and the tabs of its pages */
export default async function ProjectLayout({ children, params }: LayoutProps<'/app/projects/[projectId]'>) {
    const { projectId } = await params;
    const context = await requireAppContext();
    const project = await getVisibleProject(context, projectId);
    if (!project)
        notFound();
    const client = project.clientId ? (await getClient(context.workspace.id, project.clientId))?.doc : undefined;

    const tabs = [
        { href: KnownPageLinks.project(project.id), label: 'Comments' },
        { href: KnownPageLinks.projectInstall(project.id), label: 'Install' },
        { href: KnownPageLinks.projectSettings(project.id), label: 'Settings' }
    ];

    return (
        <>
            <PageHeader
                className="pb-0"
                title={(
                    <span className="flex items-center gap-3">
                        <ProjectMark name={project.name} className="size-8 rounded-lg text-sm" />
                        <span className="min-w-0">{project.name}</span>
                    </span>
                )}
                description={(
                    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span className="font-mono text-[13px]">
                            {project.urls[0] && (
                                // A plain link: next/link would prefetch it, and opening it mints a single-use review code
                                <a
                                    href={KnownPageLinks.projectReview(project.id, project.urls[0])}
                                    target="_blank"
                                    rel="noopener"
                                    title="Open review"
                                    className="underline-offset-4 hover:text-foreground hover:underline">
                                    {displayUrl(project.urls[0])}
                                </a>
                            )}
                            {project.urls.length > 1 && <span className="text-muted-foreground"> +{project.urls.length - 1}</span>}
                        </span>
                        <ProjectAccessInfo access={project.access}>
                            {project.access === 'guests' && project.urls[0] && <GuestReviewLinks publicId={project.publicId} urls={project.urls} />}
                        </ProjectAccessInfo>
                        {client && (
                            <span className="flex min-w-0 items-center gap-1.5">
                                <ClientMark client={clientSummary(client)} />
                                <span className="min-w-0 break-words">Client: {client.name}</span>
                            </span>
                        )}
                        {project.status === 'done' && (
                            <Badge variant="outline" className="gap-1.5">
                                <span aria-hidden="true" className="size-1.5 rounded-full bg-[hsl(var(--brand-success))]" />
                                Done
                            </Badge>
                        )}
                    </span>
                )}
                actions={(
                    <>
                        {context.isAdmin && project.access !== 'disabled' && <InviteButton projectId={project.id} variant="outline" />}
                        <ReviewLinksMenu projectId={project.id} urls={project.urls} variant="default" />
                    </>
                )}>
                <LinkTabs label="Project" tabs={tabs} match="path" className="mt-2" />
            </PageHeader>
            <div className="flex flex-col gap-6 pt-6">
                {children}
            </div>
        </>
    );
}
