'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { CheckIcon, ChevronsUpDownIcon, SettingsIcon } from 'lucide-react';
import { Mark } from '@uier/brand/Mark';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/src/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/src/components/ui/sidebar';
import { KnownPages } from '@/src/knownPages';
import { switchWorkspaceAction } from './actions';

export type WorkspaceOption = { id: string; name: string; role: string };

/** The app icon: the mark on an ink plate (BRAND.md "App icon") */
function AppIcon() {
    return (
        <span aria-hidden="true" className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Mark size={15} />
        </span>
    );
}

function WorkspaceLabel({ workspace }: { workspace: WorkspaceOption }) {
    return (
        <span className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{workspace.name}</span>
            <span className="truncate text-xs text-muted-foreground">{workspace.role}</span>
        </span>
    );
}

/**
 * The current workspace at the top of the sidebar. Its menu switches when there is more than one,
 * and opens the workspace settings for admins (`canManage`).
 */
export function WorkspaceSwitcher({ workspaces, currentWorkspaceId, canManage = false }: {
    workspaces: WorkspaceOption[];
    currentWorkspaceId: string;
    canManage?: boolean;
}) {
    const { isMobile } = useSidebar();
    const [pending, startTransition] = useTransition();
    const current = workspaces.find(workspace => workspace.id === currentWorkspaceId) ?? workspaces[0];
    if (!current)
        return null;

    const canSwitch = workspaces.length > 1;
    if (!canSwitch && !canManage) {
        return (
            <SidebarMenu>
                <SidebarMenuItem>
                    <SidebarMenuButton size="lg" asChild>
                        <Link href={KnownPages.App}>
                            <AppIcon />
                            <WorkspaceLabel workspace={current} />
                        </Link>
                    </SidebarMenuButton>
                </SidebarMenuItem>
            </SidebarMenu>
        );
    }

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <SidebarMenuButton size="lg" disabled={pending} className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground">
                            <AppIcon />
                            <span className="sr-only">Workspace: </span>
                            <WorkspaceLabel workspace={current} />
                            <ChevronsUpDownIcon className="ml-auto" />
                        </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-xl"
                        align="start"
                        side={isMobile ? 'bottom' : 'right'}
                        sideOffset={4}>
                        {canSwitch && (
                            <DropdownMenuGroup>
                                <DropdownMenuLabel className="text-xs text-muted-foreground">Workspaces</DropdownMenuLabel>
                                {workspaces.map(workspace => (
                                    <DropdownMenuItem
                                        key={workspace.id}
                                        onSelect={() => startTransition(() => switchWorkspaceAction(workspace.id))}>
                                        <span className="flex min-w-0 flex-1 flex-col">
                                            <span className="truncate">{workspace.name}</span>
                                            <span className="text-xs text-muted-foreground">{workspace.role}</span>
                                        </span>
                                        {workspace.id === current.id && <CheckIcon className="ml-auto" />}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuGroup>
                        )}
                        {canSwitch && canManage && <DropdownMenuSeparator />}
                        {canManage && (
                            <DropdownMenuItem asChild>
                                <Link href={KnownPages.AppSettings}>
                                    <SettingsIcon />
                                    Workspace settings
                                </Link>
                            </DropdownMenuItem>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    );
}
