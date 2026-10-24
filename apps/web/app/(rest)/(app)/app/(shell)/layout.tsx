import type { PropsWithChildren } from 'react';
import Link from 'next/link';
import { Container } from '@signalco/ui-primitives/Container';
import { Logo } from '@uier/brand/Logo';
import { KnownPages } from '@/src/knownPages';
import { requireAppContext } from '@/src/lib/app/context';
import { AppNav, type AppNavLink } from '@/src/components/app/shell/AppNav';
import { AccountMenu } from '@/src/components/app/shell/AccountMenu';

/** The signed-in app: header with navigation and the account menu */
export default async function AppShellLayout({ children }: PropsWithChildren) {
    const context = await requireAppContext();
    const links: AppNavLink[] = [
        { href: KnownPages.AppProjects, label: 'Projects' },
        { href: KnownPages.AppBilling, label: 'Billing' }
    ];

    return (
        <div className="flex min-h-full flex-col">
            <header className="border-b">
                <Container className="flex h-14 items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-4">
                        <Link href={KnownPages.App} aria-label="uier app home" className="shrink-0">
                            <Logo size={18} />
                        </Link>
                        <AppNav links={links} />
                    </div>
                    <AccountMenu
                        name={context.user.name}
                        email={context.user.email}
                        currentWorkspaceId={context.workspace.id}
                        workspaces={context.memberships.map(({ workspace, member }) => ({
                            id: workspace.id,
                            name: workspace.name,
                            role: member.role === 'admin' ? 'Admin' : 'Commenter'
                        }))} />
                </Container>
            </header>
            <main className="flex-1 py-8 md:py-12">
                <Container>
                    {children}
                </Container>
            </main>
        </div>
    );
}
