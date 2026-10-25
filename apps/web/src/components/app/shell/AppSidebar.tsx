'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGridIcon, PlusIcon, UsersIcon } from 'lucide-react';
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
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { ProjectMark } from '../projects/ProjectMark';
import { AccountMenu } from './AccountMenu';
import { WorkspaceSwitcher, type WorkspaceOption } from './WorkspaceSwitcher';

export type SidebarProject = { id: string; name: string };

function isCurrent(pathname: string, href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The app's navigation: the workspace, the main sections, the active projects for quick switching
 * and the signed-in person. Collapses to icons on desktop and opens as a sheet on small screens.
 */
export function AppSidebar({ isAdmin, user, workspaces, currentWorkspaceId, projects }: {
    isAdmin: boolean;
    user: { name: string; email: string };
    workspaces: WorkspaceOption[];
    currentWorkspaceId: string;
    /** Active projects, newest first */
    projects: SidebarProject[];
}) {
    const pathname = usePathname();
    // On small screens the sidebar is a sheet: close it once a link has opened its page
    const { setOpenMobile } = useSidebar();
    useEffect(() => setOpenMobile(false), [pathname, setOpenMobile]);
    // A listed project is current in its own entry; Projects covers the list and every other project page
    const inListedProject = projects.some(project => isCurrent(pathname, KnownPageLinks.project(project.id)));
    const sections = [
        { href: KnownPages.AppProjects, label: 'Projects', icon: LayoutGridIcon, current: isCurrent(pathname, KnownPages.AppProjects) && !inListedProject },
        ...(isAdmin ? [{ href: KnownPages.AppUsers, label: 'Users', icon: UsersIcon, current: isCurrent(pathname, KnownPages.AppUsers) }] : [])
    ];

    return (
        <Sidebar variant="inset" collapsible="icon">
            <SidebarHeader>
                <WorkspaceSwitcher workspaces={workspaces} currentWorkspaceId={currentWorkspaceId} />
            </SidebarHeader>
            <SidebarContent>
                <nav aria-label="App" className="contents">
                    <SidebarGroup>
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
                    {(projects.length > 0 || isAdmin) && (
                        <SidebarGroup>
                            <SidebarGroupLabel>Active projects</SidebarGroupLabel>
                            {isAdmin && (
                                <SidebarGroupAction asChild title="Create project">
                                    <Link href={KnownPages.AppNewProject}>
                                        <PlusIcon />
                                        <span className="sr-only">Create project</span>
                                    </Link>
                                </SidebarGroupAction>
                            )}
                            <SidebarGroupContent>
                                <SidebarMenu>
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
                            </SidebarGroupContent>
                        </SidebarGroup>
                    )}
                </nav>
            </SidebarContent>
            <SidebarFooter>
                <AccountMenu name={user.name} email={user.email} />
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    );
}
