import { notFound } from 'next/navigation';
import { Badge } from '@/src/components/ui/badge';
import { KnownPageLinks } from '@/src/knownPages';
import { requireAppContext } from '@/src/lib/app/context';
import { getVisibleProject } from '@/src/lib/app/projects';
import { clientSummary, getClient } from '@/src/lib/app/clients';
import { PageHeader } from '@/src/components/app/PageHeader';
import { ProjectSettingsLink } from '@/src/components/app/projects/ProjectSettingsLink';
import { ProjectMark } from '@/src/components/app/projects/ProjectMark';
import { ClientMark } from '@/src/components/app/clients/ClientMark';
import { ReviewLinksMenu } from '@/src/components/app/projects/ReviewLinksMenu';
import { InviteButton } from '@/src/components/app/users/InviteDialog';
import { ProjectAccessInfo } from '@/src/components/app/projects/ProjectAccessInfo';
import { GuestReviewLinks } from '@/src/components/app/projects/GuestReviewLinks';

/** A project: its name, review actions (Open review lists every address) and settings, above its comments, settings or install guide */
export default async function ProjectLayout({ children, params }: LayoutProps<'/app/projects/[projectId]'>) {
    const { projectId } = await params;
    const context = await requireAppContext();
    const project = await getVisibleProject(context, projectId);
    if (!project)
        notFound();
    const client = project.clientId ? (await getClient(context.workspace.id, project.clientId))?.doc : undefined;

    return (
        <>
            <PageHeader
                title={(
                    <span className="flex items-center gap-3">
                        <ProjectMark name={project.name} url={project.urls[0]} className="size-8 rounded-lg text-sm [&>img]:p-1.5" />
                        <span className="min-w-0">{project.name}</span>
                    </span>
                )}
                description={(
                    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        {client && (
                            <span className="flex min-w-0 items-center gap-1.5">
                                <ClientMark client={clientSummary(client)} />
                                <span className="min-w-0 break-words">Client: {client.name}</span>
                            </span>
                        )}
                        {/* Who can comment, with the guest links and (for admins) Invite in its popover */}
                        <ProjectAccessInfo access={project.access}>
                            {project.access === 'guests' && project.urls[0] && <GuestReviewLinks publicId={project.publicId} urls={project.urls} />}
                            {context.isAdmin && project.access !== 'disabled' && <InviteButton projectId={project.id} variant="outline" className="w-full" />}
                        </ProjectAccessInfo>
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
                        <ReviewLinksMenu projectId={project.id} urls={project.urls} variant="default" visit />
                        {/* Settings (and the install guide from there) instead of tabs: the comments are the project's page */}
                        <ProjectSettingsLink href={KnownPageLinks.projectSettings(project.id)} installHref={KnownPageLinks.projectInstall(project.id)} />
                    </>
                )} />
            <div className="flex flex-col gap-6">
                {children}
            </div>
        </>
    );
}
