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
import { useRovingTabStop } from '../keyboard/keys';

/** The navigation's one tab stop and its place among the links (`useRovingTabStop`) */
type RovingProps = { 'data-roving-item': string; tabIndex: number };

function isCurrent(pathname: string, href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
}

/** An icon link in the active projects header, named by a tooltip */
function GroupLinkAction({ href, label, children }: { href: string; label: string; children: ReactNode }) {
    return (
        <Tooltip>
            <TooltipTrigger render={<SidebarGroupAction className="text-sidebar-foreground/70" render={<Link href={href} />} />}>
                {children}
                <span className="sr-only">{label}</span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
    );
}

/** A top-level page of the app: its icon and name, current on it and the pages below it */
function NavItem({ href, label, icon: Icon, current, roving }: { href: string; label: string; icon: LucideIcon; current: boolean; roving: RovingProps }) {
    return (
        <SidebarMenuItem>
            <SidebarMenuButton {...roving} isActive={current} tooltip={label} render={<Link href={href} aria-current={current ? 'page' : undefined} />}>
                <Icon />
                <span>{label}</span>
            </SidebarMenuButton>
        </SidebarMenuItem>
    );
}

/** An active project's entry: its favicon and name, current on its pages */
function ProjectItem({ project, current, roving }: { project: SidebarProject; current: boolean; roving: RovingProps }) {
    return (
        <SidebarMenuItem>
            <SidebarMenuButton {...roving} isActive={current} tooltip={project.name} render={<Link href={KnownPageLinks.project(project.id)} aria-current={current ? 'page' : undefined} />}>
                {/* A 20 px tile with the mark's own 2 px padding inside its border (uier #87), so the favicon sits on the tile
                    as in the project header and the projects list. The negative margin keeps it in the 16 px icon slot:
                    names line up with the pages above, also collapsed and in the sheet */}
                <ProjectMark name={project.name} projectId={project.id} url={project.url} className="-m-0.5 size-5 text-xs" />
                <span>{project.name}</span>
            </SidebarMenuButton>
        </SidebarMenuItem>
    );
}

const statusLabels = { active: 'Active', done: 'Done' } as const;

/**
 * The app's navigation: the workspace switcher, Projects, the active projects for quick switching (or, grouped by
 * status, every project),
 * then at the bottom the workspace area (users, teams, clients and settings in tabs), feedback on the
 * app and the signed-in person. Collapses to icons on desktop and opens as a sheet on small screens.
 */
export function AppSidebar({ isAdmin, user, workspaces, currentWorkspaceId, projects, projectOrder, hasClients }: {
    isAdmin: boolean;
    user: { name: string; email: string; avatarUrl?: string };
    workspaces: WorkspaceOption[];
    currentWorkspaceId: string;
    /** The projects the person can see, active and done, with their client and latest activity */
    projects: SidebarProject[];
    /** How this browser lists them (a cookie, so the first render is already in order) */
    projectOrder: ProjectOrder;
    /** Whether a project the person can see has a client (the workspace area shows its clients then) */
    hasClients: boolean;
}) {
    const pathname = usePathname();
    const groupId = useId();
    // Applied at once. Saving sets the cookie, so Next renders the layout again: after switching to Recent activity
    // (or, by recent activity, to grouping by status), the projects without activity read yet first count from their
    // creation, then from the activity that render reads
    const [order, setOrder] = useState(projectOrder);
    const changeOrder = (next: ProjectOrder) => {
        setOrder(next);
        saveProjectOrderAction(next).catch(() => toast.error('Could not save the project order. Try again.'));
    };
    // Only active projects, unless grouped by status
    const groups = orderProjects(projects, order);
    const listed = groups.flatMap(group => group.projects);
    const grouped = groups.some(group => group.client || group.status);
    const active = projects.filter(project => project.status !== 'done');
    const canCreate = isAdmin && active.length > 0;
    // On small screens the sidebar is a sheet: close it once a link has opened its page
    const { setOpenMobile } = useSidebar();
    useEffect(() => setOpenMobile(false), [pathname, setOpenMobile]);
    // A listed project is current in its own entry; Projects covers the list and every other project page
    const inListedProject = listed.some(project => isCurrent(pathname, KnownPageLinks.project(project.id)));
    const projectsCurrent = isCurrent(pathname, KnownPages.AppProjects) && !inListedProject;
    // Admins manage the workspace's people and settings; everyone else sees the clients of their projects
    const workspaceHref = isAdmin ? KnownPages.AppUsers : hasClients ? KnownPages.AppClients : undefined;
    // The navigation is one tab stop, like a list (the current page's link, or the one last focused): ↓ and ↑ move
    // between its links, Home and End to the first and the last. The group's buttons (order, Create project) keep theirs.
    const links = [KnownPages.AppProjects, KnownPages.AppMyWork, ...(!active.length && isAdmin ? [KnownPages.AppNewProject] : []),
        ...listed.map(project => KnownPageLinks.project(project.id)), ...(workspaceHref ? [workspaceHref] : [])];
    const currentLink = projectsCurrent ? KnownPages.AppProjects
        : isCurrent(pathname, KnownPages.AppMyWork) ? KnownPages.AppMyWork
            : workspaceHref && isCurrent(pathname, KnownPages.AppWorkspace) ? workspaceHref
                : listed.map(project => KnownPageLinks.project(project.id)).find(href => isCurrent(pathname, href));
    const roving = useRovingTabStop(links, { preferred: currentLink, orientation: 'vertical' });

    return (
        <Sidebar variant="inset" collapsible="icon">
            <SidebarHeader>
                <WorkspaceSwitcher workspaces={workspaces} currentWorkspaceId={currentWorkspaceId} canManage={isAdmin} />
            </SidebarHeader>
            <SidebarContent>
                <nav aria-label="App" className="contents" {...roving.containerProps}>
                    {/* The app's own pages: Projects and the person's own work */}
                    <SidebarGroup>
                        <SidebarGroupContent>
                            <SidebarMenu>
                                <NavItem href={KnownPages.AppProjects} label="Projects" icon={LayoutGridIcon} current={projectsCurrent} roving={roving.itemProps(KnownPages.AppProjects)} />
                                <NavItem href={KnownPages.AppMyWork} label="My work" icon={InboxIcon} current={isCurrent(pathname, KnownPages.AppMyWork)} roving={roving.itemProps(KnownPages.AppMyWork)} />
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                    <SidebarGroup>
                        <SidebarGroupLabel>{order.group === 'status' ? 'All projects' : 'Active projects'}</SidebarGroupLabel>
                        {/* Ordering needs more than one project (done ones count: grouped by status, they are listed);
                            it sits left of Create project */}
                        {projects.length > 1 && (
                            <ProjectOrderMenu order={order} onChange={changeOrder} canGroupByClient={active.some(project => project.client)}
                                className={canCreate ? 'right-10' : undefined} />
                        )}
                        {/* An icon link once there are active projects; without them, "Create a project" is in the list */}
                        {canCreate && (
                            <GroupLinkAction href={KnownPages.AppNewProject} label="Create project">
                                <PlusIcon />
                            </GroupLinkAction>
                        )}
                        <SidebarGroupContent>
                            {/* Without active projects, "Create a project" is in the list itself (above the done ones) */}
                            {!active.length && (isAdmin ? (
                                <SidebarMenu>
                                    <SidebarMenuItem>
                                        <SidebarMenuButton {...roving.itemProps(KnownPages.AppNewProject)} className="text-sidebar-foreground/70" render={<Link href={KnownPages.AppNewProject} />}>
                                            <PlusIcon />
                                            <span>Create a project</span>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                </SidebarMenu>
                            ) : (
                                <p className="px-2 text-xs text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">No active projects</p>
                            ))}
                            {grouped ? groups.map((group, index) => {
                                // Each client's or status's projects are a list named by it; projects without a client come last
                                const labelId = `${groupId}-${index}`;
                                return (
                                    <div key={group.client?.id ?? group.status ?? 'none'} className="flex flex-col not-first:mt-2">
                                        <SidebarGroupLabel id={labelId} className="gap-2 font-normal">
                                            {group.client && <ClientMark client={group.client} />}
                                            <span className="truncate">{group.client?.name ?? (group.status ? statusLabels[group.status] : 'No client')}</span>
                                        </SidebarGroupLabel>
                                        <SidebarMenu aria-labelledby={labelId}>
                                            {group.projects.map(project => (
                                                <ProjectItem key={project.id} project={project} current={isCurrent(pathname, KnownPageLinks.project(project.id))} roving={roving.itemProps(KnownPageLinks.project(project.id))} />
                                            ))}
                                        </SidebarMenu>
                                    </div>
                                );
                            }) : listed.length > 0 && (
                                <SidebarMenu>
                                    {listed.map(project => (
                                        <ProjectItem key={project.id} project={project} current={isCurrent(pathname, KnownPageLinks.project(project.id))} roving={roving.itemProps(KnownPageLinks.project(project.id))} />
                                    ))}
                                </SidebarMenu>
                            )}
                        </SidebarGroupContent>
                    </SidebarGroup>
                    {workspaceHref && (
                        // At the bottom, right above feedback and the account
                        <SidebarGroup className="mt-auto">
                            <SidebarGroupContent>
                                <SidebarMenu>
                                    <NavItem href={workspaceHref} label="Workspace" icon={Building2Icon} current={isCurrent(pathname, KnownPages.AppWorkspace)} roving={roving.itemProps(workspaceHref)} />
                                </SidebarMenu>
                            </SidebarGroupContent>
                        </SidebarGroup>
                    )}
                </nav>
            </SidebarContent>
            <SidebarFooter>
                <FeedbackButton />
                <AccountMenu name={user.name} email={user.email} avatarUrl={user.avatarUrl} />
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    );
}
