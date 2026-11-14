
import { getAppI18n } from '@/src/lib/i18n/server';
import { ProjectLoading } from '@/src/components/app/projects/ProjectLoading';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Badge } from '@/src/components/ui/badge';
import { requireAppContext } from '@/src/lib/app/context';
import { getVisibleProjectForPage as getVisibleProject } from '@/src/lib/app/projectLinkPage';
import { clientSummary, getClient } from '@/src/lib/app/clients';
import { PageHeader } from '@/src/components/app/PageHeader';
import { ProjectTabs } from '@/src/components/app/projects/ProjectTabs';
import { ProjectMark } from '@/src/components/app/projects/ProjectMark';
import { ClientInfo } from '@/src/components/app/clients/ClientInfo';
import { InviteButton } from '@/src/components/app/users/InviteDialog';
import { ProjectAccessInfo } from '@/src/components/app/projects/ProjectAccessInfo';
import { GuestReviewLinks } from '@/src/components/app/projects/GuestReviewLinks';
import { hasProjectFeedback } from '@/src/lib/app/projectComments';
import { PUBLIC_WORKSPACE_ID } from '@/src/lib/comments/publicProjectPolicy';
import { KnownPageLinks } from '@/src/knownPages';

/**
 * A project: its name (Open review, listing every address, is in the shell's top bar; uier #406), then its tabs with the settings cog at their right
 * end, above its comments, install guide or settings
 */
async function ProjectLayoutContent({ children, params }: LayoutProps<'/app/projects/[projectId]'>) {
    const { t } = await getAppI18n();
    const { projectId } = await params;
    const context = await requireAppContext();
    const project = await getVisibleProject(context, projectId);
    if (!project)
        notFound();
    const [client, feedback] = await Promise.all([
        project.clientId ? getClient(context.workspace.id, project.clientId).then(found => found?.doc) : undefined,
        hasProjectFeedback(context, project)
    ]);
    // Those who configure the project (settingsContext's rule) change who can comment from the label
    const canConfigure = context.isAdmin && project.workspaceId !== PUBLIC_WORKSPACE_ID;
    const invited = project.access === 'invited';

    return (
        // On the comments and page checks the header is as wide as what is under them (marked with data-header-wide):
        // the panel's width less the gutters, from the left, list and board alike (uier #363), so it stays put when the
        // board scrolls. Other project pages keep the reading width. The tabs are the header's sibling, not its child, so they
        // can stick under the top bar while the whole page scrolls (uier #413); `--project-tabs` is their height, which what
        // sticks below them (the thread beside the list, the settings' sections) clears.
        <div className="group/project flex flex-col [--project-tabs:2.5rem]">
            <PageHeader
                className="min-w-0 pb-4 group-has-[[data-header-wide]]/project:page-wide"
                media={<ProjectMark name={project.name} projectId={project.id} url={project.urls[0]} className="size-14 rounded-xl text-xl [&>img]:p-2.5" />}
                title={project.name}
                description={(
                    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        {/* The client opens the projects list filtered to it, on the tab of this project's status (uier #241); hover it for more (uier #421) */}
                        {client && (
                            <ClientInfo
                                client={clientSummary(client)}
                                projectId={project.id}
                                href={KnownPageLinks.clientProjects(client.id, project.status === 'done' ? 'done' : 'active')} />
                        )}
                        {/* Who can comment, with the guest links and (for admins) Invite in its popover; admins follow it to
                            People and teams (invited people) or to Who can comment (uier #421) */}
                        <ProjectAccessInfo
                            access={project.access}
                            href={canConfigure ? (invited ? KnownPageLinks.projectSettings(project.id, 'people') : KnownPageLinks.projectAccessSettings(project.id)) : undefined}
                            accessHref={canConfigure ? KnownPageLinks.projectAccessSettings(project.id) : undefined}>
                            {project.access === 'guests' && project.urls[0] && <GuestReviewLinks publicId={project.publicId} urls={project.urls} />}
                            {context.isAdmin && project.access !== 'disabled' && <InviteButton projectId={project.id} variant="outline" className="w-full" />}
                        </ProjectAccessInfo>
                        {project.status === 'done' && (
                            <Badge variant="outline" className="gap-1.5">
                                <span aria-hidden="true" className="size-1.5 rounded-full bg-[hsl(var(--brand-success))]" />{t("Done")}</Badge>
                        )}
                    </span>
                )} />
            <ProjectTabs projectId={project.id} install={!feedback} />
            <div className="flex flex-col gap-6 pt-6">
                {children}
            </div>
        </div>
    );
}

export default function ProjectLayout(props: Parameters<typeof ProjectLayoutContent>[0]) {
    // Shaped like the project's header, tabs and comments, as wide as they will be (uier #344)
    return <Suspense fallback={<ProjectLoading />}><ProjectLayoutContent {...props} /></Suspense>;
}
