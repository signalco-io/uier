'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useActionState, useId, useState, useTransition } from 'react';
import Link from 'next/link';
import { CheckIcon, ChevronsUpDownIcon, MegaphoneIcon, PlusIcon, SettingsIcon } from 'lucide-react';
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

export type WorkspaceOption = {
    id: string;
    name: string;
    /** The person's role, or what the workspace is to them */
    role: string;
    /**
     * uier's own workspace, which everyone joins to send feedback on the app: not a workspace the
     * person works in, so the menu keeps it apart from theirs
     */
    feedback?: boolean;
};

/** The app icon: the mark on an ink plate (BRAND.md "App icon") */
function AppIcon() {
    return (
        <span aria-hidden="true" className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Mark size={15} />
        </span>
    );
}

function WorkspaceLabel({ workspace }: { workspace: WorkspaceOption }) {
    const { t } = useAppI18n();
    return (
        <span className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{workspace.name}</span>
            <span className="truncate text-xs text-muted-foreground">{t(workspace.role)}</span>
        </span>
    );
}

/** The new workspace's name; a created workspace opens on its first project, so the dialog never closes on success */
function CreateWorkspaceForm() {
    const { t } = useAppI18n();
    const id = useId();
    const [name, setName] = useState('');
    const [state, formAction, pending] = useActionState(createWorkspaceAction, null);
    return (
        <form action={formAction} className="flex flex-col gap-6">
            <DialogHeader>
                <DialogTitle>{t("Create workspace")}</DialogTitle>
                <DialogDescription>{t("A separate place for its own projects and people. You are its admin.")}</DialogDescription>
            </DialogHeader>
            <Field>
                <FieldLabel htmlFor={`${id}-name`}>{t("Workspace name")}</FieldLabel>
                <Input
                    id={`${id}-name`}
                    name="name"
                    value={name}
                    onChange={event => setName(event.target.value)}
                    required
                    autoFocus
                    maxLength={MAX_WORKSPACE_NAME_LENGTH} />
                <FieldDescription>{t("Everyone in the workspace sees it in the workspace menu.")}</FieldDescription>
            </Field>
            <FormMessage state={state} />
            <DialogFooter>
                <DialogClose render={<Button type="button" variant="outline" />}>{t("Cancel")}</DialogClose>
                <Button type="submit" disabled={pending}>
                    {pending && <Spinner data-icon="inline-start" />}
                    {t("Create workspace")}{' '}</Button>
            </DialogFooter>
        </form>
    );
}

/**
 * The current workspace at the top of the sidebar. Its menu lists the person's workspaces (the current one
 * checked, also when it is the only one) to switch between, creates a new one,
 * opens the workspace settings for admins (`canManage`) and, apart from the person's workspaces, the
 * feedback they sent on uier (`feedback`).
 */
export function WorkspaceSwitcher({ workspaces, currentWorkspaceId, canManage = false }: {
    workspaces: WorkspaceOption[];
    currentWorkspaceId: string;
    canManage?: boolean;
}) {
    const { t } = useAppI18n();
    const { isMobile } = useSidebar();
    const [pending, startTransition] = useTransition();
    const [creating, setCreating] = useState(false);
    const current = workspaces.find(workspace => workspace.id === currentWorkspaceId) ?? workspaces[0];
    if (!current)
        return null;

    const own = workspaces.filter(workspace => !workspace.feedback);
    const feedback = workspaces.find(workspace => workspace.feedback);
    const switchTo = (workspaceId: string) => startTransition(() => switchWorkspaceAction(workspaceId));
    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <DropdownMenu>
                    <DropdownMenuTrigger render={<SidebarMenuButton size="lg" disabled={pending} className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground" />}>
                        <AppIcon />
                        <span className="sr-only">{t("Workspace:")}{' '}</span>
                        <WorkspaceLabel workspace={current} />
                        <ChevronsUpDownIcon className="ml-auto" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        className="w-(--anchor-width) min-w-56 rounded-xl"
                        align="start"
                        side={isMobile ? "bottom" : "right"}
                        sideOffset={4}>
                        {/* Always the person's workspaces, the current one checked, also when it is the only one (uier #257) */}
                        {own.length > 0 && (
                            <>
                                <DropdownMenuGroup>
                                    <DropdownMenuLabel className="text-xs text-muted-foreground">{t("Workspaces")}</DropdownMenuLabel>
                                    {own.map(workspace => (
                                        <DropdownMenuItem key={workspace.id} onClick={() => workspace.id !== current.id && switchTo(workspace.id)}>
                                            <span className="flex min-w-0 flex-1 flex-col">
                                                <span className="truncate">{workspace.name}</span>
                                                <span className="text-xs text-muted-foreground">{t(workspace.role)}</span>
                                            </span>
                                            {workspace.id === current.id && <><CheckIcon aria-hidden="true" className="ml-auto" /><span className="sr-only">{t("current")}</span></>}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuGroup>
                                <DropdownMenuSeparator />
                            </>
                        )}
                        <DropdownMenuGroup>
                            {canManage && (
                                <DropdownMenuItem render={<Link href={KnownPages.AppSettings} />}>
                                    <SettingsIcon />
                                    {t("Workspace settings")}{' '}</DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => setCreating(true)}>
                                <PlusIcon />
                                {t("Create workspace")}{' '}</DropdownMenuItem>
                        </DropdownMenuGroup>
                        {feedback && (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuGroup>
                                    <DropdownMenuItem onClick={() => switchTo(feedback.id)}>
                                        <MegaphoneIcon />
                                        <span className="flex min-w-0 flex-1 flex-col">
                                            <span className="truncate">{t(feedback.name)}</span>
                                            <span className="text-xs text-muted-foreground">{t(feedback.role)}</span>
                                        </span>
                                        {feedback.id === current.id && <><CheckIcon aria-hidden="true" className="ml-auto" /><span className="sr-only">{t("current")}</span></>}
                                    </DropdownMenuItem>
                                </DropdownMenuGroup>
                            </>
                        )}
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
