'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { CheckIcon, UserPlusIcon, ChevronsUpDownIcon, CircleUserIcon, KeyboardIcon, LogOutIcon, MonitorIcon, MoonIcon, PowerIcon, SunIcon, UsersIcon } from 'lucide-react';
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

const VISIBLE_ACCOUNTS = 3;

/** The signed-in person at the bottom of the sidebar: account, theme, keyboard shortcuts and sign out */
export function AccountMenu({ name, avatarUrl, accounts }: { name: string; avatarUrl?: string; accounts: BrowserAccount[] }) {
    const { t } = useAppI18n();
    const { isMobile } = useSidebar();
    const { theme, setTheme } = useTheme();
    const [pending, startTransition] = useTransition();
    const openShortcuts = useOpenShortcutsHelp();
    const shortcutKey = useKeyShortcutLabel('?');

    const change = (input: Parameters<typeof changeAccount>[0]) => startTransition(async () => {
        try { await changeAccount(input); } catch (error) { toast.error(error instanceof Error ? error.message : t("Could not change accounts.")); }
    });

    // At most three accounts in the menu, the active one always among them (in their order); the rest
    // and Add account are in a submenu, so the menu doesn't grow with every account (uier #249)
    const shown = accounts.length <= VISIBLE_ACCOUNTS ? accounts : (() => {
        let others = VISIBLE_ACCOUNTS - (accounts.some(account => account.active) ? 1 : 0);
        return accounts.filter(account => account.active || others-- > 0);
    })();
    const more = accounts.filter(account => !shown.includes(account));
    const atCap = accounts.length >= MAX_BROWSER_ACCOUNTS;

    const accountItem = (account: BrowserAccount) => (
        <DropdownMenuItem key={account.id} disabled={pending || account.active}
            onClick={() => change({ action: 'switch', userId: account.id })}>
            <PersonAvatar name={account.name} avatarUrl={account.avatarUrl} size="sm" aria-hidden="true" />
            <span className="grid min-w-0 flex-1">
                <span className="truncate">{account.name}</span>
                <span className="truncate text-xs text-muted-foreground">{account.email}</span>
            </span>
            {account.active && <><CheckIcon aria-hidden="true" /><span className="sr-only">{t("active")}</span></>}
        </DropdownMenuItem>
    );
    const addAccount = (
        <>
            <DropdownMenuItem disabled={pending || atCap} render={<a href={`${KnownPages.AppSignIn}?add=1`} />}>
                <UserPlusIcon />{t("Add account")}{' '}</DropdownMenuItem>
            {atCap && <DropdownMenuLabel className="font-normal text-muted-foreground">{MAX_BROWSER_ACCOUNTS} {t("accounts. Sign out to add another.")}</DropdownMenuLabel>}
        </>
    );

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <DropdownMenu>
                    {/* A row like Give feedback and the navigation above it: the avatar is centred in their 16px
                        icon column (spilling over its box, not widening it), so names line up with their labels,
                        expanded and collapsed; the email is in the menu's account list */}
                    <DropdownMenuTrigger render={<SidebarMenuButton disabled={pending} className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground" />}>
                        <span className="sr-only">{t("Account:")}{' '}</span>
                        <span className="flex size-4 shrink-0 items-center justify-center">
                            <PersonAvatar name={name} avatarUrl={avatarUrl} size="sm" aria-hidden="true" />
                        </span>
                        <span className="truncate">{name}</span>
                        <ChevronsUpDownIcon className="ml-auto" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        className="w-(--anchor-width) min-w-56 rounded-xl"
                        side={isMobile ? "bottom" : "right"}
                        align="end"
                        sideOffset={4}>
                        {/* No header with the active person: the list marks them (uier #248) */}
                        <DropdownMenuGroup>
                            <DropdownMenuLabel>{t("Signed-in accounts")}</DropdownMenuLabel>
                            {shown.map(accountItem)}
                            {more.length ? (
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger>
                                        <UsersIcon />
                                        {t(more.length === 1 ? '{count} more account' : '{count} more accounts', { count: more.length })}
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent className="min-w-56">
                                        <DropdownMenuGroup>
                                            {more.map(accountItem)}
                                            {addAccount}
                                        </DropdownMenuGroup>
                                    </DropdownMenuSubContent>
                                </DropdownMenuSub>
                            ) : addAccount}
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            <DropdownMenuItem render={<Link href={KnownPages.AppAccount} />}>
                                <CircleUserIcon />
                                {t("Account")}{' '}</DropdownMenuItem>
                            <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                    <SunIcon />
                                    {t("Theme")}{' '}</DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                    <DropdownMenuRadioGroup value={theme ?? 'system'} onValueChange={setTheme}>
                                        {themeOptions.map(option => (
                                            <DropdownMenuRadioItem key={option.value} value={option.value}>
                                                {t(option.label)}
                                            </DropdownMenuRadioItem>
                                        ))}
                                    </DropdownMenuRadioGroup>
                                </DropdownMenuSubContent>
                            </DropdownMenuSub>
                            {/* Also for those who don't know `?`, or have the single-key shortcuts off */}
                            <DropdownMenuItem onClick={openShortcuts}>
                                <KeyboardIcon />
                                {t("Keyboard shortcuts")}{' '}{shortcutKey && <DropdownMenuShortcut aria-hidden="true" className="font-mono tracking-normal">{shortcutKey}</DropdownMenuShortcut>}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={pending} onClick={() => change({ action: 'sign-out' })}>
                            <LogOutIcon />
                            {t("Sign out")}{' '}</DropdownMenuItem>
                        {accounts.length > 1 && <DropdownMenuItem disabled={pending} onClick={() => change({ action: 'sign-out-all' })}>
                            <PowerIcon />{t("Sign out of all accounts")}{' '}</DropdownMenuItem>}
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    );
}
