import type { PropsWithChildren } from 'react';
import { Separator } from '@/src/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/src/components/ui/sidebar';
import { requireAppContext } from '@/src/lib/app/context';
import { listVisibleProjects } from '@/src/lib/app/projects';
import { loadSidebarProjects } from '@/src/lib/app/sidebarProjects';
import { getProjectOrder } from '@/src/lib/app/projectOrderCookie';
import { AppSidebar } from '@/src/components/app/shell/AppSidebar';
import { avatarUrl } from '@/src/lib/app/avatars';
import { AppBreadcrumbs } from '@/src/components/app/shell/AppBreadcrumbs';
import { PUBLIC_WORKSPACE_ID } from '@/src/lib/comments/publicProjectPolicy';
import { loadWorkspaceAccessForRender } from '@/src/lib/app/access';
import { InviteProvider } from '@/src/components/app/users/InviteDialog';

/** The signed-in app: the sidebar, a top bar with the breadcrumbs, and the page in an inset panel */
export default async function AppShellLayout({ children }: PropsWithChildren) {
    const context = await requireAppContext();
    const projectOrder = await getProjectOrder();
    const visibleProjects = listVisibleProjects(context);
    // The sidebar's reads start once the projects are listed, alongside the access snapshot
    const [projects, access, sidebarProjects] = await Promise.all([
        visibleProjects,
        context.isAdmin ? loadWorkspaceAccessForRender(context.workspace.id) : undefined,
        visibleProjects.then(listed => loadSidebarProjects(context, listed, projectOrder))
    ]);
    const teams = access?.teams.map(({ id, name }) => ({ id, name })) ?? [];

    return (
        <SidebarProvider>
            <InviteProvider teams={teams} enabled={context.isAdmin && context.workspace.id !== PUBLIC_WORKSPACE_ID} projects={projects.map(({ id, name, status }) => ({ id, name, status }))}>
                <AppSidebar
                    isAdmin={context.isAdmin && context.workspace.id !== PUBLIC_WORKSPACE_ID}
                    user={{ name: context.user.name, email: context.user.email, avatarUrl: avatarUrl(context.user) }}
                    currentWorkspaceId={context.workspace.id}
                    workspaces={context.memberships.map(({ workspace, member }) => {
                        // Everyone joins uier's workspace to send feedback on the app; its admins (uier staff) work in it
                        const feedback = workspace.id === PUBLIC_WORKSPACE_ID && member.role !== 'admin';
                        return {
                            id: workspace.id,
                            name: feedback ? 'Feedback on uier' : workspace.name,
                            role: feedback ? 'Sent with Give feedback' : member.role === 'admin' ? 'Admin' : 'Commenter',
                            feedback
                        };
                    })}
                    projects={sidebarProjects}
                    projectOrder={projectOrder}
                    hasClients={projects.some(project => project.clientId)} />
                {/* Where the sidebar is docked (lg) the panel keeps its frame and scrolls inside it, like a desktop app.
                    Narrower (phones, tablets in portrait) the sidebar is a sheet and the page scrolls under a sticky top bar. */}
                <SidebarInset className="min-w-0 lg:h-[calc(100svh-1rem)] lg:overflow-hidden">
                    <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3 lg:static">
                        <SidebarTrigger />
                        <Separator orientation="vertical" className="mr-1 data-vertical:h-4 data-vertical:self-center" />
                        <AppBreadcrumbs projectNames={Object.fromEntries(projects.map(project => [project.id, project.name]))} />
                    </header>
                    {/* While an element marked data-page-width="wide" is in it, the panel is a container, so the
                        column can measure it for `page-wide` (global.css) */}
                    <div className="flex-1 lg:overflow-y-auto has-data-[page-width=wide]:[container-type:inline-size]">
                        {/* A reading width, on every page. An element that lays things side by side (the comments
                            board) breaks out of it to the panel's width with `page-wide`; the rest of its page stays */}
                        <div className="mx-auto flex w-full max-w-5xl flex-col px-4 py-6 [--page-wide:calc(100cqw-2rem)] md:px-8 md:py-10 md:[--page-wide:calc(100cqw-4rem)]">
                            {children}
                        </div>
                    </div>
                </SidebarInset>
            </InviteProvider>
        </SidebarProvider>
    );
}
