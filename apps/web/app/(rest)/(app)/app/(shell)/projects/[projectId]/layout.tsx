import { notFound } from 'next/navigation';
import { Badge } from '@/src/components/ui/badge';
import { KnownPageLinks } from '@/src/knownPages';
import { requireAppContext } from '@/src/lib/app/context';
import { getVisibleProject } from '@/src/lib/app/projects';
import { PageHeader } from '@/src/components/app/PageHeader';
import { LinkTabs } from '@/src/components/app/LinkTabs';
import { ProjectMark } from '@/src/components/app/projects/ProjectMark';
import { ReviewLinksMenu } from '@/src/components/app/projects/ReviewLinksMenu';
import { InviteButton } from '@/src/components/app/users/InviteDialog';
import { AccessIcon, displayUrl, projectAccessLabels } from '@/src/components/app/projects/projectLabels';
import { notificationPreference } from '@/src/lib/notifications/preferences';
import { NotificationControls } from '@/src/components/app/comments/NotificationControls';

/** A project: its name, sites and review actions, and the tabs of its pages */
export default async function ProjectLayout({ children, params }: LayoutProps<'/app/projects/[projectId]'>) {
    const { projectId } = await params;
    const context = await requireAppContext();
    const project = await getVisibleProject(context, projectId);
    if (!project)
        notFound();
    const notifications = await notificationPreference(project.id, `user:${context.user.id}`);

    const tabs = [
        { href: KnownPageLinks.project(project.id), label: 'Comments' },
        { href: KnownPageLinks.projectInstall(project.id), label: 'Install' },
        ...(context.isAdmin ? [{ href: KnownPageLinks.projectSettings(project.id), label: 'Settings' }] : [])
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
                            {displayUrl(project.urls[0] ?? '')}
                            {project.urls.length > 1 && <span className="text-muted-foreground"> +{project.urls.length - 1}</span>}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <AccessIcon access={project.access} className="size-4" aria-hidden="true" />
                            {projectAccessLabels[project.access].label}
                        </span>
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
                        <NotificationControls projectId={project.id} muted={notifications?.muted} />
                        {context.isAdmin && <InviteButton projectId={project.id} variant="outline" />}
                        <ReviewLinksMenu projectId={project.id} urls={project.urls} variant="default" />
                    </>
                )}>
                <LinkTabs label="Project" tabs={tabs} match="path" className="mt-2" />
            </PageHeader>
            <div className="flex flex-col gap-6 pt-6">
                <p className="text-sm text-muted-foreground">Owners and admins get new feedback. Posting follows a thread. Emails are batched for 5 minutes.</p>
                {children}
            </div>
        </>
    );
}
