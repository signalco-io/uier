'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { ChevronsUpDownIcon, CircleUserIcon, LogOutIcon, MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger
} from '@/src/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/src/components/ui/sidebar';
import { KnownPages } from '@/src/knownPages';
import { PersonAvatar } from '../PersonAvatar';
import { signOutAction } from './actions';
import { clearAppReplyDrafts } from '../comments/replyDrafts';

export const themeOptions = [
    { value: 'light', label: 'Light', icon: SunIcon },
    { value: 'dark', label: 'Dark', icon: MoonIcon },
    { value: 'system', label: 'System', icon: MonitorIcon }
] as const;

/** The signed-in person at the bottom of the sidebar: account, theme and sign out */
export function AccountMenu({ name, email, avatarUrl }: { name: string; email: string; avatarUrl?: string }) {
    const { isMobile } = useSidebar();
    const { theme, setTheme } = useTheme();
    const [pending, startTransition] = useTransition();

    // The menu's header: the person with their email
    const person = (
        <>
            <PersonAvatar name={name} avatarUrl={avatarUrl} aria-hidden="true" />
            <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{name}</span>
                <span className="truncate text-xs text-muted-foreground">{email}</span>
            </span>
        </>
    );

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <DropdownMenu>
                    {/* A row like Give feedback and the navigation above it: the avatar is centred in their 16px
                        icon column (spilling over its box, not widening it), so names line up with their labels,
                        expanded and collapsed; the email is in the menu */}
                    <DropdownMenuTrigger render={<SidebarMenuButton disabled={pending} className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground" />}>
                        <span className="sr-only">Account: </span>
                        <span className="flex size-4 shrink-0 items-center justify-center">
                            <PersonAvatar name={name} avatarUrl={avatarUrl} size="sm" aria-hidden="true" />
                        </span>
                        <span className="truncate">{name}</span>
                        <ChevronsUpDownIcon className="ml-auto" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        className="w-(--anchor-width) min-w-56 rounded-xl"
                        side={isMobile ? 'bottom' : 'right'}
                        align="end"
                        sideOffset={4}>
                        {/* Base UI's group label needs a group */}
                        <DropdownMenuGroup>
                            <DropdownMenuLabel className="p-0 font-normal">
                                <span className="flex items-center gap-2 px-1.5 py-1.5 text-left text-sm">{person}</span>
                            </DropdownMenuLabel>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            <DropdownMenuItem render={<Link href={KnownPages.AppAccount} />}>
                                <CircleUserIcon />
                                Account
                            </DropdownMenuItem>
                            <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                    <SunIcon />
                                    Theme
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                    <DropdownMenuRadioGroup value={theme ?? 'system'} onValueChange={setTheme}>
                                        {themeOptions.map(option => (
                                            <DropdownMenuRadioItem key={option.value} value={option.value}>
                                                {option.label}
                                            </DropdownMenuRadioItem>
                                        ))}
                                    </DropdownMenuRadioGroup>
                                </DropdownMenuSubContent>
                            </DropdownMenuSub>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => { clearAppReplyDrafts(); startTransition(() => signOutAction()); }}>
                            <LogOutIcon />
                            Sign out
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    );
}
