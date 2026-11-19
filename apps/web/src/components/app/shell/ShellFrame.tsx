'use client';

import { InboxIcon, LayoutGridIcon, MegaphoneIcon, type LucideIcon } from 'lucide-react';
import { Separator } from '@/src/components/ui/separator';
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarHeader,
    SidebarInset,
    SidebarMenu,
    SidebarMenuItem,
    SidebarProvider,
    SidebarTrigger
} from '@/src/components/ui/sidebar';
import { cn } from '@/src/lib/utils';
import { Bar, HeaderOutline } from '../loading/outlines';
import { WorkspaceMark } from '../workspace/WorkspaceMark';

/** The shell's inset panel and the column a page sits in; shared with the loaded layout so the two cannot drift */
export const shellInsetClassName = 'min-w-0 lg:h-[calc(100svh-1rem)] lg:overflow-hidden';
export const shellTopBarClassName = 'sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3 lg:static';
export const shellScrollClassName = 'flex-1 lg:overflow-y-auto lg:[scrollbar-gutter:stable]';
export const shellColumnClassName = 'mx-auto flex w-full max-w-5xl flex-col px-4 py-6 [--page-gutter:1rem] [--page-wide:calc(100cqw-2rem)] md:px-8 md:pt-6 md:pb-10 md:[--page-gutter:2rem] md:[--page-wide:calc(100cqw-4rem)]';

/** A bar on the sidebar: the sidebar's own grey is the default skeleton's, which would not show on it */
function SideBar({ className }: { className?: string }) {
    return <Bar className={cn('bg-sidebar-accent', className)} />;
}

/** A navigation row as `SidebarMenuButton` lays it out: its real icon where the row is always there, then its label's bar */
function Row({ icon: Icon, width }: { icon?: LucideIcon; width: string }) {
    return (
        <SidebarMenuItem>
            <div className="flex h-8 w-full items-center gap-2 rounded-md p-2 group-data-[collapsible=icon]:size-8 [&_svg]:size-4 [&_svg]:shrink-0">
                {Icon ? <Icon /> : <SideBar className="size-4 shrink-0 rounded-sm" />}
                <SideBar className={cn('h-3.5', width)} />
            </div>
        </SidebarMenuItem>
    );
}

/**
 * The signed-in app before anything about the request is known: the static shell of every page in the sidebar
 * layout, so the first bytes of a full load already draw it (docs/design/loading-states #1 and #3). It is the loaded
 * layout's own frame, built from the same sidebar components at the same sizes, so nothing moves when the workspace
 * replaces it. Only what is the same for everyone and in every language is drawn for real: the app icon, the icons of
 * Projects, My work and Give feedback, the sidebar toggle. Their labels need the language and the rest is data
 * (the workspace, the projects, the account, the breadcrumbs, the page), so those are bars. Workspace is not here:
 * only some roles have it. Inert and hidden from assistive technology behind one status.
 */
export function ShellFrame() {
    return (
        <>
            {/* Before the app's language is known: the page's default language */}
            <span role="status" className="sr-only">Loading…</span>
            <SidebarProvider inert aria-hidden="true" data-shell-frame="">
                <Sidebar variant="inset" collapsible="icon">
                    <SidebarHeader>
                        <SidebarMenu>
                            <SidebarMenuItem>
                                <div className="flex h-12 w-full items-center gap-2 rounded-md p-2">
                                    <WorkspaceMark />
                                    <span className="grid flex-1 gap-1.5">
                                        <SideBar className="h-3.5 w-24" />
                                        <SideBar className="h-3 w-12" />
                                    </span>
                                </div>
                            </SidebarMenuItem>
                        </SidebarMenu>
                    </SidebarHeader>
                    <SidebarContent>
                        <SidebarGroup>
                            <SidebarGroupContent>
                                <SidebarMenu>
                                    <Row icon={LayoutGridIcon} width="w-16" />
                                    <Row icon={InboxIcon} width="w-14" />
                                </SidebarMenu>
                            </SidebarGroupContent>
                        </SidebarGroup>
                        <SidebarGroup>
                            {/* `SidebarGroupLabel`'s row: the list's name */}
                            <div className="flex h-8 shrink-0 items-center px-2"><SideBar className="h-3 w-24" /></div>
                            <SidebarGroupContent>
                                <SidebarMenu>
                                    <Row width="w-28" />
                                    <Row width="w-20" />
                                    <Row width="w-24" />
                                </SidebarMenu>
                            </SidebarGroupContent>
                        </SidebarGroup>
                    </SidebarContent>
                    <SidebarFooter className="gap-1 pt-1">
                        <SidebarMenu><Row icon={MegaphoneIcon} width="w-24" /></SidebarMenu>
                        <SidebarMenu>
                            <SidebarMenuItem>
                                <div className="flex h-8 w-full items-center gap-2 rounded-md p-2">
                                    <SideBar className="size-4 shrink-0 rounded-full" />
                                    <SideBar className="h-3.5 w-28" />
                                </div>
                            </SidebarMenuItem>
                        </SidebarMenu>
                    </SidebarFooter>
                </Sidebar>
                <SidebarInset className={shellInsetClassName}>
                    <header className={shellTopBarClassName}>
                        <SidebarTrigger tabIndex={-1} />
                        <Separator orientation="vertical" className="mr-1 data-vertical:h-4 data-vertical:self-center" />
                        <Bar className="h-4 w-28" />
                    </header>
                    <div className={shellScrollClassName}>
                        <div className={shellColumnClassName}>
                            {/* Every page starts with its title where `PageHeader` puts it */}
                            <HeaderOutline />
                        </div>
                    </div>
                </SidebarInset>
            </SidebarProvider>
        </>
    );
}
