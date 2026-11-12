import { orderedStatuses } from '@/src/lib/app/statusWorkflow';
import { effectiveStatusWorkflow } from '@/src/lib/app/statusWorkflows';

import { getAppI18n } from '@/src/lib/i18n/server';
import { ProjectLoading } from '@/src/components/app/projects/ProjectLoading';
import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/src/components/ui/badge';
import { cn } from '@/src/lib/utils';
import { requireAppContext } from '@/src/lib/app/context';
import { getVisibleProjectForPage as getVisibleProject } from '@/src/lib/app/projectLinkPage';
import { clientSummary, getClient } from '@/src/lib/app/clients';
import { PageHeader } from '@/src/components/app/PageHeader';
import { ProjectTabs } from '@/src/components/app/projects/ProjectTabs';
import { ProjectMark } from '@/src/components/app/projects/ProjectMark';
import { ClientMark } from '@/src/components/app/clients/ClientMark';
import { ReviewLinksMenu } from '@/src/components/app/projects/ReviewLinksMenu';
import { InviteButton } from '@/src/components/app/users/InviteDialog';
import { ProjectAccessInfo } from '@/src/components/app/projects/ProjectAccessInfo';
import { GuestReviewLinks } from '@/src/components/app/projects/GuestReviewLinks';
import { hasProjectFeedback } from '@/src/lib/app/projectComments';
import { PUBLIC_WORKSPACE_ID } from '@/src/lib/comments/publicProjectPolicy';
import { KnownPageLinks } from '@/src/knownPages';

/**
 * A project: its name and Open review (it lists every address), then its tabs with the settings cog at their right
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

    // The board's columns and gaps (20rem a column), the width the comments header and this header take in Board:
    // the statuses, then Archive, a 3rem strip while collapsed and a column like the others when expanded
    const workflow = effectiveStatusWorkflow(context.workspace, project);
    const columns = orderedStatuses(workflow).filter(status => status.category !== 'archive').length;
    const archives = workflow.statuses.filter(status => status.category === 'archive').length;
    const boardWidths = {
        "--board-width-collapsed": `calc(${columns} * 20rem + ${columns + archives - 1}rem + ${archives} * 3rem)`,
        "--board-width-expanded": `calc(${columns + archives} * 20rem + ${columns + archives - 1}rem)`
    };

    return (
        // On the comments page the header is as wide as the comments' header under it (ProjectComments marks it with
        // data-header-wide): the list with its thread, or the board's columns up to the panel's width less the gutters,
        // so it stays put when the board scrolls. Page checks marks itself as list width too; other project pages keep the reading width.
        <div className="group/project @container/project flex flex-col [--board-width:var(--board-width-collapsed)] has-[[data-board-archive=expanded]]:[--board-width:var(--board-width-expanded)]"
            style={boardWidths as React.CSSProperties}>
            <PageHeader
                className={cn('min-w-0',
                    'group-has-[[data-header-wide=list]]/project:@3xl/project:w-[min(var(--page-wide),96rem)] group-has-[[data-header-wide=list]]/project:@3xl/project:mx-[calc((100%-min(var(--page-wide),96rem))/2)]',
                    'group-has-[[data-header-wide=board]]/project:md:w-[min(var(--page-wide),max(100%,var(--board-width)))] group-has-[[data-header-wide=board]]/project:md:mx-[calc((100%-min(var(--page-wide),max(100%,var(--board-width))))/2)]')}
                media={<ProjectMark name={project.name} projectId={project.id} url={project.urls[0]} className="size-14 rounded-xl text-xl [&>img]:p-2.5" />}
                title={project.name}
                description={(
                    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        {/* The client opens the projects list filtered to it, on the tab of this project's status (uier #241) */}
                        {client && (
                            <Link
                                href={KnownPageLinks.clientProjects(client.id, project.status === 'done' ? 'done' : 'active')}
                                className="flex min-w-0 items-center gap-1.5 rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                                <ClientMark client={clientSummary(client)} />
                                <span className="min-w-0 break-words">{t("Client:")}{' '}{client.name}</span>
                            </Link>
                        )}
                        {/* Who can comment, with the guest links and (for admins) Invite in its popover; admins follow it to the setting */}
                        <ProjectAccessInfo access={project.access} settingsHref={canConfigure ? KnownPageLinks.projectAccessSettings(project.id) : undefined}>
                            {project.access === 'guests' && project.urls[0] && <GuestReviewLinks publicId={project.publicId} urls={project.urls} />}
                            {context.isAdmin && project.access !== 'disabled' && <InviteButton projectId={project.id} variant="outline" className="w-full" />}
                        </ProjectAccessInfo>
                        {project.status === 'done' && (
                            <Badge variant="outline" className="gap-1.5">
                                <span aria-hidden="true" className="size-1.5 rounded-full bg-[hsl(var(--brand-success))]" />{t("Done")}</Badge>
                        )}
                    </span>
                )}
                actions={<ReviewLinksMenu projectId={project.id} urls={project.urls} variant="default" visit />}>
                <ProjectTabs projectId={project.id} install={!feedback} />
            </PageHeader>
            <div className="flex flex-col gap-6">
                {children}
            </div>
        </div>
    );
}

export default function ProjectLayout(props: Parameters<typeof ProjectLayoutContent>[0]) {
    // Shaped like the project's header, tabs and comments, as wide as they will be (uier #344)
    return <Suspense fallback={<ProjectLoading />}><ProjectLayoutContent {...props} /></Suspense>;
}
