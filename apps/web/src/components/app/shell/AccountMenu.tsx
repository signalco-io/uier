'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { CheckIcon, UserPlusIcon, ChevronsUpDownIcon, CircleUserIcon, KeyboardIcon, LogOutIcon, MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger
} from '@/src/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/src/components/ui/sidebar';
import { KnownPages } from '@/src/knownPages';
import { PersonAvatar } from '../PersonAvatar';
import { changeAccount } from './accountSessions';
import type { BrowserAccount } from '@/src/lib/app/browserAccounts';
import { MAX_BROWSER_ACCOUNTS } from '@/src/lib/app/browserAccountLimits';
import { toast } from 'sonner';
import { useOpenShortcutsHelp } from '../keyboard/AppShortcuts';
import { useKeyShortcutLabel } from '../keyboard/keys';

export const themeOptions = [
    { value: 'light', label: 'Light', icon: SunIcon },
    { value: 'dark', label: 'Dark', icon: MoonIcon },
    { value: 'system', label: 'System', icon: MonitorIcon }
] as const;

/** The signed-in person at the bottom of the sidebar: account, theme, keyboard shortcuts and sign out */
export function AccountMenu({ name, email, avatarUrl, accounts }: { name: string; email: string; avatarUrl?: string; accounts: BrowserAccount[] }) {
    const { isMobile } = useSidebar();
    const { theme, setTheme } = useTheme();
    const [pending, startTransition] = useTransition();
    const openShortcuts = useOpenShortcutsHelp();
    const shortcutKey = useKeyShortcutLabel('?');

    const change = (input: Parameters<typeof changeAccount>[0]) => startTransition(async () => {
        try { await changeAccount(input); } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not change accounts.'); }
    });

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
                            <DropdownMenuLabel>Signed-in accounts</DropdownMenuLabel>
                            {accounts.map(account => (
                                <DropdownMenuItem key={account.id} disabled={pending || account.active}
                                    onClick={() => change({ action: 'switch', userId: account.id })}>
                                    <PersonAvatar name={account.name} avatarUrl={account.avatarUrl} size="sm" aria-hidden="true" />
                                    <span className="grid min-w-0 flex-1">
                                        <span className="truncate">{account.name}</span>
                                        <span className="truncate text-xs text-muted-foreground">{account.email}</span>
                                    </span>
                                    {account.active && <><CheckIcon aria-hidden="true" /><span className="sr-only">active</span></>}
                                </DropdownMenuItem>
                            ))}
                            <DropdownMenuItem disabled={pending || accounts.length >= MAX_BROWSER_ACCOUNTS} render={<a href={`${KnownPages.AppSignIn}?add=1`} />}>
                                <UserPlusIcon />Add account
                            </DropdownMenuItem>
                            {accounts.length >= MAX_BROWSER_ACCOUNTS && <DropdownMenuLabel className="font-normal text-muted-foreground">5 accounts. Sign out to add another.</DropdownMenuLabel>}
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
                            {/* Also for those who don't know `?`, or have the single-key shortcuts off */}
                            <DropdownMenuItem onClick={openShortcuts}>
                                <KeyboardIcon />
                                Keyboard shortcuts
                                {shortcutKey && <DropdownMenuShortcut aria-hidden="true" className="font-mono tracking-normal">{shortcutKey}</DropdownMenuShortcut>}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={pending} onClick={() => change({ action: 'sign-out' })}>
                            <LogOutIcon />
                            Sign out
                        </DropdownMenuItem>
                        {accounts.length > 1 && <DropdownMenuItem disabled={pending} onClick={() => change({ action: 'sign-out-all' })}>
                            <LogOutIcon />Sign out of all accounts
                        </DropdownMenuItem>}
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    );
}
