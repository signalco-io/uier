'use client';

import { useActionState, useId, useState, useTransition } from 'react';
import Link from 'next/link';
import { CheckIcon, ChevronsUpDownIcon, PlusIcon, SettingsIcon } from 'lucide-react';
import { Mark } from '@uier/brand/Mark';
import { Button } from '@/src/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/src/components/ui/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/src/components/ui/dropdown-menu';
import { Field, FieldDescription, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/src/components/ui/sidebar';
import { Spinner } from '@/src/components/ui/spinner';
import { KnownPages } from '@/src/knownPages';
import { MAX_WORKSPACE_NAME_LENGTH } from '@/src/lib/app/limits';
import { FormMessage } from '../FormMessage';
import { createWorkspaceAction, switchWorkspaceAction } from './actions';

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

/** The new workspace's name; a created workspace opens on its first project, so the dialog never closes on success */
function CreateWorkspaceForm() {
    const id = useId();
    const [name, setName] = useState('');
    const [state, formAction, pending] = useActionState(createWorkspaceAction, null);
    return (
        <form action={formAction} className="flex flex-col gap-6">
            <DialogHeader>
                <DialogTitle>Create workspace</DialogTitle>
                <DialogDescription>A separate place for its own projects and people. You are its admin.</DialogDescription>
            </DialogHeader>
            <Field>
                <FieldLabel htmlFor={`${id}-name`}>Workspace name</FieldLabel>
                <Input
                    id={`${id}-name`}
                    name="name"
                    value={name}
                    onChange={event => setName(event.target.value)}
                    required
                    autoFocus
                    maxLength={MAX_WORKSPACE_NAME_LENGTH} />
                <FieldDescription>Everyone in the workspace sees it in the workspace menu.</FieldDescription>
            </Field>
            <FormMessage state={state} />
            <DialogFooter>
                <DialogClose asChild>
                    <Button type="button" variant="outline">Cancel</Button>
                </DialogClose>
                <Button type="submit" disabled={pending}>
                    {pending && <Spinner data-icon="inline-start" />}
                    Create workspace
                </Button>
            </DialogFooter>
        </form>
    );
}

/**
 * The current workspace at the top of the sidebar. Its menu switches workspaces, creates a new one,
 * and opens the workspace settings for admins (`canManage`).
 */
export function WorkspaceSwitcher({ workspaces, currentWorkspaceId, canManage = false }: {
    workspaces: WorkspaceOption[];
    currentWorkspaceId: string;
    canManage?: boolean;
}) {
    const { isMobile } = useSidebar();
    const [pending, startTransition] = useTransition();
    const [creating, setCreating] = useState(false);
    const current = workspaces.find(workspace => workspace.id === currentWorkspaceId) ?? workspaces[0];
    if (!current)
        return null;

    const canSwitch = workspaces.length > 1;
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
                            <>
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
                                <DropdownMenuSeparator />
                            </>
                        )}
                        <DropdownMenuGroup>
                            {canManage && (
                                <DropdownMenuItem asChild>
                                    <Link href={KnownPages.AppSettings}>
                                        <SettingsIcon />
                                        Workspace settings
                                    </Link>
                                </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onSelect={() => setCreating(true)}>
                                <PlusIcon />
                                Create workspace
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
                <Dialog open={creating} onOpenChange={setCreating}>
                    <DialogContent>
                        {/* The content unmounts when closed, so every opening starts empty */}
                        <CreateWorkspaceForm />
                    </DialogContent>
                </Dialog>
            </SidebarMenuItem>
        </SidebarMenu>
    );
}
