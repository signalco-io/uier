import { getAppI18n } from '@/src/lib/i18n/server';
import type { PropsWithChildren } from 'react';
import { AppBoundary } from '@/src/components/app/AppBoundary';
import { ShellFrame, shellColumnClassName, shellInsetClassName, shellTopBarClassName } from '@/src/components/app/shell/ShellFrame';
import { ShellInfoProvider, type ShellInfo } from '@/src/components/app/shell/ShellInfo';
import { Separator } from '@/src/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/src/components/ui/sidebar';
import { requireAppContext } from '@/src/lib/app/context';
import { listVisibleProjects } from '@/src/lib/app/projects';
import { loadSidebarProjects } from '@/src/lib/app/sidebarProjects';
import { getBrowserAccounts } from '@/src/lib/app/session';
import { AccountSessionBoundary } from '@/src/components/app/shell/AccountSessionBoundary';
import { getProjectOrder } from '@/src/lib/app/projectOrderCookie';
import { AppSidebar } from '@/src/components/app/shell/AppSidebar';
import { avatarUrl } from '@/src/lib/app/avatars';
import { AppBreadcrumbs } from '@/src/components/app/shell/AppBreadcrumbs';
import { AppTopBarActions } from '@/src/components/app/shell/AppTopBarActions';
import { PUBLIC_WORKSPACE_ID } from '@/src/lib/comments/publicProjectPolicy';
import { loadWorkspaceAccessForRender } from '@/src/lib/app/access';
import { InviteProvider } from '@/src/components/app/users/InviteDialog';
import { AppShortcuts } from '@/src/components/app/keyboard/AppShortcuts';
import { isGoogleSignInConfigured } from '@/src/lib/app/google/config';
import { isMicrosoftSignInConfigured } from '@/src/lib/app/microsoft/config';

/** The signed-in app: the sidebar, a top bar with the breadcrumbs (and a project's Open review at its right end), and the page in an inset panel, with the keyboard shortcuts */
async function AppShellLayoutContent({ children }: PropsWithChildren) {
    const { t } = await getAppI18n();
    const context = await requireAppContext();
    const projectOrder = await getProjectOrder();
    const visibleProjects = listVisibleProjects(context);
    // The sidebar's reads start once the projects are listed, alongside the access snapshot
    const [projects, access, sidebarProjects, accounts] = await Promise.all([
        visibleProjects,
        context.isAdmin ? loadWorkspaceAccessForRender(context.workspace.id) : undefined,
        visibleProjects.then(listed => loadSidebarProjects(context, listed, projectOrder)),
        getBrowserAccounts()
    ]);
    const teams = access?.teams.map(({ id, name }) => ({ id, name })) ?? [];
    // What the pages' loading states may show at once, since the sidebar beside them already does
    const listed = new Map(sidebarProjects.map(project => [project.id, project]));
    const shellInfo: ShellInfo = {
        workspace: { name: context.workspace.name, admin: context.isAdmin, feedback: context.workspace.id === PUBLIC_WORKSPACE_ID, teams: access && access.teams.length > 0, clients: projects.some(project => project.clientId) },
        signIn: { google: isGoogleSignInConfigured(), microsoft: isMicrosoftSignInConfigured() },
        projects: Object.fromEntries(projects.map(project => [project.id, {
            name: project.name, url: project.urls[0], status: project.status === 'done' ? 'done' as const : 'active' as const,
            open: listed.get(project.id)?.openCount,
            // Activity after its creation is a thread the person can see (read only when the projects are ordered by it)
            feedback: (listed.get(project.id)?.activityAt ?? '') > project.createdAt || undefined
        }]))
    };

    return (
        <SidebarProvider>
            <AccountSessionBoundary userId={context.user.id} />
            {/* The keyboard shortcuts of every page, and `?` to list them */}
            <AppShortcuts>
            <InviteProvider teams={teams} enabled={context.isAdmin && context.workspace.id !== PUBLIC_WORKSPACE_ID} projects={projects.map(({ id, name, status }) => ({ id, name, status }))}>
                <AppSidebar
                    accounts={accounts}
                    isAdmin={context.isAdmin && context.workspace.id !== PUBLIC_WORKSPACE_ID}
                    user={{ name: context.user.name, email: context.user.email, avatarUrl: avatarUrl(context.user) }}
                    currentWorkspaceId={context.workspace.id}
                    workspaces={context.memberships.map(({ workspace, member }) => {
                        // Everyone joins uier's workspace to send feedback on the app; its admins (uier staff) work in it.
                        // The switcher lists it for everyone else only while it is current (uier #257)
                        const feedback = workspace.id === PUBLIC_WORKSPACE_ID && member.role !== 'admin';
                        return {
                            id: workspace.id,
                            name: feedback ? t('Feedback on uier') : workspace.name,
                            role: feedback ? t('Sent with Give feedback') : member.role === 'admin' ? t('Admin') : t('Commenter'),
                            feedback
                        };
                    })}
                    projects={sidebarProjects}
                    projectOrder={projectOrder}
                    hasClients={projects.some(project => project.clientId)} />
                {/* Where the sidebar is docked (lg) the panel keeps its frame and scrolls inside it, like a desktop app.
                    Narrower (phones, tablets in portrait) the sidebar is a sheet and the page scrolls under a sticky top bar. */}
                <SidebarInset className={shellInsetClassName}>
                    <header className={shellTopBarClassName}>
                        <SidebarTrigger />
                        <Separator orientation="vertical" className="mr-1 data-vertical:h-4 data-vertical:self-center" />
                        <AppBreadcrumbs projects={Object.fromEntries(projects.map(project => [project.id, { name: project.name, url: project.urls[0] }]))} />
                        {/* A project's Open review, right-aligned beside the breadcrumbs (uier #406) */}
                        <AppTopBarActions projects={Object.fromEntries(projects.map(project => [project.id, { urls: project.urls }]))} />
                    </header>
                    <div className="flex-1 lg:overflow-y-auto">
                        {/* While an element marked data-page-width="wide" is in it, this is a container, so the column can
                            measure it for `page-wide` (global.css). Inside the scrolling panel, not the panel itself: a
                            scroller's `cqw` takes in its scrollbar where scrollbars take room (always shown), and the
                            board would then be that much wider than the panel and scroll it sideways */}
                        <div className="has-data-[page-width=wide]:[container-type:inline-size]">
                            {/* A reading width, on every page. An element that lays things side by side (the comments
                                board) breaks out of it to the panel's width with `page-wide` (less the gutters, `--page-gutter`) or `page-bleed`
                                (edge to edge, padded by them); the rest of its page stays. The space above the page header
                                is the 24px under it (PageHeader's pb-6, the gap to the comments' search), at every width (uier #181) */}
                            <div className={shellColumnClassName}>
                                <ShellInfoProvider value={shellInfo}>{children}</ShellInfoProvider>
                            </div>
                        </div>
                    </div>
                </SidebarInset>
            </InviteProvider>
            </AppShortcuts>
        </SidebarProvider>
    );
}

/**
 * The frame first (`ShellFrame`, the static shell of every page here), then the language and the workspace together:
 * one step from the first bytes to the app, with nothing that moves between them.
 */
export default function AppShellLayout(props: Parameters<typeof AppShellLayoutContent>[0]) {
    return <AppBoundary fallback={<ShellFrame />}><AppShellLayoutContent {...props} /></AppBoundary>;
}
