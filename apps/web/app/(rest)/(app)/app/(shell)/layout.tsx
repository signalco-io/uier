import type { PropsWithChildren } from 'react';
import { Separator } from '@/src/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/src/components/ui/sidebar';
import { requireAppContext } from '@/src/lib/app/context';
import { listVisibleProjects } from '@/src/lib/app/projects';
import { AppSidebar } from '@/src/components/app/shell/AppSidebar';
import { AppBreadcrumbs } from '@/src/components/app/shell/AppBreadcrumbs';
import { InviteProvider } from '@/src/components/app/users/InviteDialog';

/** The signed-in app: the sidebar, a top bar with the breadcrumbs, and the page in an inset panel */
export default async function AppShellLayout({ children }: PropsWithChildren) {
    const context = await requireAppContext();
    const projects = await listVisibleProjects(context);

    return (
        <SidebarProvider>
            <InviteProvider projects={projects.map(({ id, name, status }) => ({ id, name, status }))}>
                <AppSidebar
                    isAdmin={context.isAdmin}
                    user={{ name: context.user.name, email: context.user.email }}
                    currentWorkspaceId={context.workspace.id}
                    workspaces={context.memberships.map(({ workspace, member }) => ({
                        id: workspace.id,
                        name: workspace.name,
                        role: member.role === 'admin' ? 'Admin' : 'Commenter'
                    }))}
                    projects={projects.filter(project => project.status !== 'done').map(({ id, name }) => ({ id, name }))} />
                {/* On wide screens the panel keeps its frame and scrolls inside it, like a desktop app */}
                <SidebarInset className="min-w-0 md:h-[calc(100svh-1rem)] md:overflow-hidden">
                    <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3 md:static">
                        <SidebarTrigger />
                        <Separator orientation="vertical" className="mr-1 data-vertical:h-4 data-vertical:self-center" />
                        <AppBreadcrumbs projectNames={Object.fromEntries(projects.map(project => [project.id, project.name]))} />
                    </header>
                    <div className="flex-1 md:overflow-y-auto">
                        <div className="mx-auto flex w-full max-w-5xl flex-col px-4 py-6 md:px-8 md:py-10">
                            {children}
                        </div>
                    </div>
                </SidebarInset>
            </InviteProvider>
        </SidebarProvider>
    );
}
