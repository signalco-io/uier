'use client';

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2Icon, InboxIcon, LayoutGridIcon, PlusIcon, type LucideIcon } from 'lucide-react';
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupAction,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
    useSidebar
} from '@/src/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { ProjectMark } from '../projects/ProjectMark';
import { AccountMenu } from './AccountMenu';
import { FeedbackButton } from './FeedbackButton';
import { WorkspaceSwitcher, type WorkspaceOption } from './WorkspaceSwitcher';

export type SidebarProject = { id: string; name: string; url?: string };

function isCurrent(pathname: string, href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
}

/** An icon link in the active projects header, named by a tooltip */
function GroupLinkAction({ href, label, children }: { href: string; label: string; children: ReactNode }) {
    return (
        <Tooltip>
            <TooltipTrigger render={<SidebarGroupAction render={<Link href={href} />} />}>
                {children}
                <span className="sr-only">{label}</span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
    );
}

/** A top-level page of the app: its icon and name, current on it and the pages below it */
function NavItem({ href, label, icon: Icon, current }: { href: string; label: string; icon: LucideIcon; current: boolean }) {
    return (
        <SidebarMenuItem>
            <SidebarMenuButton isActive={current} tooltip={label} render={<Link href={href} aria-current={current ? 'page' : undefined} />}>
                <Icon />
                <span>{label}</span>
            </SidebarMenuButton>
        </SidebarMenuItem>
    );
}

/**
 * The app's navigation: the workspace switcher, Projects, the active projects for quick switching,
 * then at the bottom the workspace area (users, teams, clients and settings in tabs), feedback on the
 * app and the signed-in person. Collapses to icons on desktop and opens as a sheet on small screens.
 */
export function AppSidebar({ isAdmin, user, workspaces, currentWorkspaceId, projects, hasClients }: {
    isAdmin: boolean;
    user: { name: string; email: string };
    workspaces: WorkspaceOption[];
    currentWorkspaceId: string;
    /** Active projects, newest first */
    projects: SidebarProject[];
    /** Whether a project the person can see has a client (the workspace area shows its clients then) */
    hasClients: boolean;
}) {
    const pathname = usePathname();
    // On small screens the sidebar is a sheet: close it once a link has opened its page
    const { setOpenMobile } = useSidebar();
    useEffect(() => setOpenMobile(false), [pathname, setOpenMobile]);
    // A listed project is current in its own entry; Projects covers the list and every other project page
    const inListedProject = projects.some(project => isCurrent(pathname, KnownPageLinks.project(project.id)));
    const projectsCurrent = isCurrent(pathname, KnownPages.AppProjects) && !inListedProject;
    // Admins manage the workspace's people and settings; everyone else sees the clients of their projects
    const workspaceHref = isAdmin ? KnownPages.AppUsers : hasClients ? KnownPages.AppClients : undefined;

    return (
        <Sidebar variant="inset" collapsible="icon">
            <SidebarHeader>
                <WorkspaceSwitcher workspaces={workspaces} currentWorkspaceId={currentWorkspaceId} canManage={isAdmin} />
            </SidebarHeader>
            <SidebarContent>
                <nav aria-label="App" className="contents">
                    {/* The app's own pages: Projects and the person's own work */}
                    <SidebarGroup>
                        <SidebarGroupContent>
                            <SidebarMenu>
                                <NavItem href={KnownPages.AppProjects} label="Projects" icon={LayoutGridIcon} current={projectsCurrent} />
                                <NavItem href={KnownPages.AppMyWork} label="My work" icon={InboxIcon} current={isCurrent(pathname, KnownPages.AppMyWork)} />
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                    <SidebarGroup>
                        <SidebarGroupLabel>Active projects</SidebarGroupLabel>
                        {/* Without active projects, "Create a project" is in the list itself */}
                        {isAdmin && projects.length > 0 && (
                            <GroupLinkAction href={KnownPages.AppNewProject} label="Create project">
                                <PlusIcon />
                            </GroupLinkAction>
                        )}
                        <SidebarGroupContent>
                            <SidebarMenu>
                                {projects.map(project => {
                                    const href = KnownPageLinks.project(project.id);
                                    const current = isCurrent(pathname, href);
                                    return (
                                        <SidebarMenuItem key={project.id}>
                                            <SidebarMenuButton isActive={current} tooltip={project.name} render={<Link href={href} aria-current={current ? 'page' : undefined} />}>
                                                <ProjectMark name={project.name} url={project.url} />
                                                <span>{project.name}</span>
                                            </SidebarMenuButton>
                                        </SidebarMenuItem>
                                    );
                                })}
                                {!projects.length && isAdmin && (
                                    <SidebarMenuItem>
                                        <SidebarMenuButton className="text-sidebar-foreground/70" render={<Link href={KnownPages.AppNewProject} />}>
                                            <PlusIcon />
                                            <span>Create a project</span>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                )}
                            </SidebarMenu>
                            {!projects.length && !isAdmin && (
                                <p className="px-2 text-xs text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">No active projects</p>
                            )}
                        </SidebarGroupContent>
                    </SidebarGroup>
                    {workspaceHref && (
                        // At the bottom, right above feedback and the account
                        <SidebarGroup className="mt-auto">
                            <SidebarGroupContent>
                                <SidebarMenu>
                                    <NavItem href={workspaceHref} label="Workspace" icon={Building2Icon} current={isCurrent(pathname, KnownPages.AppWorkspace)} />
                                </SidebarMenu>
                            </SidebarGroupContent>
                        </SidebarGroup>
                    )}
                </nav>
            </SidebarContent>
            <SidebarFooter>
                <FeedbackButton />
                <AccountMenu name={user.name} email={user.email} />
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    );
}
