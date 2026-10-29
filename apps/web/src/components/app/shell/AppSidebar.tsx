'use client';

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BriefcaseIcon, LayoutGridIcon, PlusIcon, UsersIcon } from 'lucide-react';
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
import { cn } from '@/src/lib/utils';
import { ProjectMark } from '../projects/ProjectMark';
import { AccountMenu } from './AccountMenu';
import { FeedbackButton } from './FeedbackButton';
import { WorkspaceSwitcher, type WorkspaceOption } from './WorkspaceSwitcher';

export type SidebarProject = { id: string; name: string };

function isCurrent(pathname: string, href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
}

/** An icon link in the active projects header, named by a tooltip */
function GroupLinkAction({ href, label, current = false, className, children }: {
    href: string;
    label: string;
    current?: boolean;
    className?: string;
    children: ReactNode;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <SidebarGroupAction
                    asChild
                    data-active={current}
                    className={cn('data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground', className)}>
                    <Link href={href} aria-current={current ? 'page' : undefined}>
                        {children}
                        <span className="sr-only">{label}</span>
                    </Link>
                </SidebarGroupAction>
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
    );
}

/**
 * The app's navigation: the workspace, the active projects for quick switching (their header links
 * to every project), then at the bottom the sections (clients, users), feedback on the app and the
 * signed-in person. Collapses to icons on desktop and opens as a sheet on small screens.
 */
export function AppSidebar({ isAdmin, user, workspaces, currentWorkspaceId, projects, hasClients }: {
    isAdmin: boolean;
    user: { name: string; email: string };
    workspaces: WorkspaceOption[];
    currentWorkspaceId: string;
    /** Active projects, newest first */
    projects: SidebarProject[];
    /** Whether a project the person can see has a client (Clients shows only then) */
    hasClients: boolean;
}) {
    const pathname = usePathname();
    // On small screens the sidebar is a sheet: close it once a link has opened its page
    const { setOpenMobile } = useSidebar();
    useEffect(() => setOpenMobile(false), [pathname, setOpenMobile]);
    // A listed project is current in its own entry; All projects covers the list and every other project page
    const inListedProject = projects.some(project => isCurrent(pathname, KnownPageLinks.project(project.id)));
    const allProjectsCurrent = isCurrent(pathname, KnownPages.AppProjects) && !inListedProject;
    // Clients first: Users keeps its place above feedback whether or not Clients shows
    const sections = [
        ...hasClients ? [{ href: KnownPages.AppClients, label: 'Clients', icon: BriefcaseIcon }] : [],
        ...isAdmin ? [{ href: KnownPages.AppTeams, label: 'Teams', icon: UsersIcon }, { href: KnownPages.AppUsers, label: 'Users', icon: UsersIcon }] : []
    ].map(section => ({ ...section, current: isCurrent(pathname, section.href) }));

    return (
        <Sidebar variant="inset" collapsible="icon">
            <SidebarHeader>
                <WorkspaceSwitcher workspaces={workspaces} currentWorkspaceId={currentWorkspaceId} />
            </SidebarHeader>
            <SidebarContent>
                <nav aria-label="App" className="contents">
                    <SidebarGroup>
                        <SidebarGroupLabel>Active projects</SidebarGroupLabel>
                        <GroupLinkAction
                            href={KnownPages.AppProjects}
                            label="All projects"
                            current={allProjectsCurrent}
                            className={isAdmin ? 'right-10' : undefined}>
                            <LayoutGridIcon />
                        </GroupLinkAction>
                        {isAdmin && (
                            <GroupLinkAction href={KnownPages.AppNewProject} label="Create project">
                                <PlusIcon />
                            </GroupLinkAction>
                        )}
                        <SidebarGroupContent>
                            <SidebarMenu>
                                {/* The header and its links hide when the sidebar is collapsed to icons */}
                                <SidebarMenuItem className="hidden group-data-[collapsible=icon]:block">
                                    <SidebarMenuButton asChild isActive={allProjectsCurrent} tooltip="All projects">
                                        <Link href={KnownPages.AppProjects} aria-current={allProjectsCurrent ? 'page' : undefined}>
                                            <LayoutGridIcon />
                                            <span>All projects</span>
                                        </Link>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                                {projects.map(project => {
                                    const href = KnownPageLinks.project(project.id);
                                    const current = isCurrent(pathname, href);
                                    return (
                                        <SidebarMenuItem key={project.id}>
                                            <SidebarMenuButton asChild isActive={current} tooltip={project.name}>
                                                <Link href={href} aria-current={current ? 'page' : undefined}>
                                                    <ProjectMark name={project.name} />
                                                    <span>{project.name}</span>
                                                </Link>
                                            </SidebarMenuButton>
                                        </SidebarMenuItem>
                                    );
                                })}
                                {!projects.length && isAdmin && (
                                    <SidebarMenuItem>
                                        <SidebarMenuButton asChild className="text-sidebar-foreground/70">
                                            <Link href={KnownPages.AppNewProject}>
                                                <PlusIcon />
                                                <span>Create a project</span>
                                            </Link>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                )}
                            </SidebarMenu>
                            {!projects.length && !isAdmin && (
                                <p className="px-2 text-xs text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">No active projects</p>
                            )}
                        </SidebarGroupContent>
                    </SidebarGroup>
                    {sections.length > 0 && (
                        // At the bottom, right above feedback and the account
                        <SidebarGroup className="mt-auto">
                            <SidebarGroupContent>
                                <SidebarMenu>
                                    {sections.map(section => (
                                        <SidebarMenuItem key={section.href}>
                                            <SidebarMenuButton asChild isActive={section.current} tooltip={section.label}>
                                                <Link href={section.href} aria-current={section.current ? 'page' : undefined}>
                                                    <section.icon />
                                                    <span>{section.label}</span>
                                                </Link>
                                            </SidebarMenuButton>
                                        </SidebarMenuItem>
                                    ))}
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
