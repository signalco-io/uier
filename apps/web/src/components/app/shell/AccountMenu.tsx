'use client';

import { useTransition } from 'react';
import { Avatar } from '@signalco/ui-primitives/Avatar';
import { Button } from '@signalco/ui-primitives/Button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@signalco/ui-primitives/Menu';
import { Check, LogOut, User } from '@signalco/ui-icons';
import { KnownPages } from '../../../knownPages';
import { signOutAction, switchWorkspaceAction } from './actions';

type WorkspaceOption = { id: string; name: string; role: string };

/** The signed-in person: workspaces (when there is more than one), account and sign out */
export function AccountMenu({ name, email, workspaces, currentWorkspaceId }: {
    name: string;
    email: string;
    workspaces: WorkspaceOption[];
    currentWorkspaceId: string;
}) {
    const [pending, startTransition] = useTransition();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="plain"
                    size="sm"
                    disabled={pending}
                    startDecorator={<Avatar size="sm" aria-hidden="true">{(name[0] ?? '?').toUpperCase()}</Avatar>}>
                    {/* The name is the visible label (from small screens up, only the avatar) */}
                    <span className="sr-only">Account: </span>
                    <span className="sr-only max-w-40 truncate sm:not-sr-only">{name}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuLabel>
                    <span className="block truncate font-medium">{name}</span>
                    <span className="block truncate text-xs font-normal text-muted-foreground">{email}</span>
                </DropdownMenuLabel>
                {workspaces.length > 1 && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Workspaces</DropdownMenuLabel>
                        {workspaces.map(workspace => (
                            <DropdownMenuItem
                                key={workspace.id}
                                startDecorator={workspace.id === currentWorkspaceId ? <Check className="size-4" /> : <span className="size-4" />}
                                onSelect={() => startTransition(() => switchWorkspaceAction(workspace.id))}>
                                <span className="truncate">{workspace.name}</span>
                                <span className="ml-auto pl-3 text-xs text-muted-foreground">{workspace.role}</span>
                            </DropdownMenuItem>
                        ))}
                    </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem href={KnownPages.AppAccount} startDecorator={<User className="size-4" />}>
                    Account
                </DropdownMenuItem>
                <DropdownMenuItem
                    startDecorator={<LogOut className="size-4" />}
                    onSelect={() => startTransition(() => signOutAction())}>
                    Sign out
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
