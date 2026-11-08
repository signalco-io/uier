'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { toast } from 'sonner';
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
import { orderProjects, type ProjectOrder } from '@/src/lib/app/projectOrder';
import type { SidebarProject } from '@/src/lib/app/sidebarProjects';
import { ClientMark } from '../clients/ClientMark';
import { ProjectMark } from '../projects/ProjectMark';
import { AccountMenu } from './AccountMenu';
import { FeedbackButton } from './FeedbackButton';
import { ProjectOrderMenu } from './ProjectOrderMenu';
import { WorkspaceSwitcher, type WorkspaceOption } from './WorkspaceSwitcher';
import { saveProjectOrderAction } from './actions';

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

/** An active project's entry: its favicon and name, current on its pages */
function ProjectItem({ project, current }: { project: SidebarProject; current: boolean }) {
    return (
        <SidebarMenuItem>
            <SidebarMenuButton isActive={current} tooltip={project.name} render={<Link href={KnownPageLinks.project(project.id)} aria-current={current ? 'page' : undefined} />}>
                <ProjectMark name={project.name} url={project.url} />
                <span>{project.name}</span>
            </SidebarMenuButton>
        </SidebarMenuItem>
    );
}

/**
 * The app's navigation: the workspace switcher, Projects, the active projects for quick switching,
 * then at the bottom the workspace area (users, teams, clients and settings in tabs), feedback on the
 * app and the signed-in person. Collapses to icons on desktop and opens as a sheet on small screens.
 */
export function AppSidebar({ isAdmin, user, workspaces, currentWorkspaceId, projects, projectOrder, hasClients }: {
    isAdmin: boolean;
    user: { name: string; email: string };
    workspaces: WorkspaceOption[];
    currentWorkspaceId: string;
    /** Active projects, with their client and latest activity */
    projects: SidebarProject[];
    /** How this browser lists them (a cookie, so the first render is already in order) */
    projectOrder: ProjectOrder;
    /** Whether a project the person can see has a client (the workspace area shows its clients then) */
    hasClients: boolean;
}) {
    const pathname = usePathname();
    const groupId = useId();
    // Applied at once. Saving sets the cookie, so Next renders the layout again: after switching from Alphabetical,
    // Recent first orders by creation time, then by the activity that render reads
    const [order, setOrder] = useState(projectOrder);
    const changeOrder = (next: ProjectOrder) => {
        setOrder(next);
        saveProjectOrderAction(next).catch(() => toast.error('Could not save the project order. Try again.'));
    };
    const groups = orderProjects(projects, order);
    const grouped = groups.some(group => group.client);
    const canCreate = isAdmin && projects.length > 0;
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
                        {/* Ordering needs more than one project; it sits left of Create project */}
                        {projects.length > 1 && (
                            <ProjectOrderMenu order={order} onChange={changeOrder} canGroup={projects.some(project => project.client)}
                                className={canCreate ? 'right-10' : undefined} />
                        )}
                        {/* Without active projects, "Create a project" is in the list itself */}
                        {canCreate && (
                            <GroupLinkAction href={KnownPages.AppNewProject} label="Create project">
                                <PlusIcon />
                            </GroupLinkAction>
                        )}
                        <SidebarGroupContent>
                            {grouped ? groups.map((group, index) => {
                                // Each client's projects are a list named by the client; the rest come last
                                const labelId = `${groupId}-${index}`;
                                return (
                                    <div key={group.client?.id ?? 'none'} className="flex flex-col not-first:mt-2">
                                        <SidebarGroupLabel id={labelId} className="gap-2 font-normal">
                                            {group.client && <ClientMark client={group.client} />}
                                            <span className="truncate">{group.client?.name ?? 'No client'}</span>
                                        </SidebarGroupLabel>
                                        <SidebarMenu aria-labelledby={labelId}>
                                            {group.projects.map(project => (
                                                <ProjectItem key={project.id} project={project} current={isCurrent(pathname, KnownPageLinks.project(project.id))} />
                                            ))}
                                        </SidebarMenu>
                                    </div>
                                );
                            }) : (
                                <SidebarMenu>
                                    {groups[0]?.projects.map(project => (
                                        <ProjectItem key={project.id} project={project} current={isCurrent(pathname, KnownPageLinks.project(project.id))} />
                                    ))}
                                    {!projects.length && isAdmin && (
                                        <SidebarMenuItem>
                                            <SidebarMenuButton className="text-sidebar-foreground/70" render={<Link href={KnownPages.AppNewProject} />}>
                                                <PlusIcon />
                                                <span>Create a project</span>
                                            </SidebarMenuButton>
                                        </SidebarMenuItem>
                                    )}
                                </SidebarMenu>
                            )}
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
