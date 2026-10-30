import type { Metadata } from 'next';
import Link from 'next/link';
import { BriefcaseIcon, ChevronRightIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/src/components/ui/empty';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/src/components/ui/item';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { requireAppContext } from '@/src/lib/app/context';
import { listVisibleProjects } from '@/src/lib/app/projects';
import { loadClients, projectClients } from '@/src/lib/app/clients';
import { PUBLIC_WORKSPACE_ID } from '@/src/lib/comments/publicProjectPolicy';
import { PageHeader } from '@/src/components/app/PageHeader';
import { ClientEditDialog } from '@/src/components/app/clients/ClientEditDialog';
import { ClientMark } from '@/src/components/app/clients/ClientMark';

export const metadata: Metadata = {
    title: 'Clients'
};

/** "2 active, 1 done" */
function statusText(active: number, done: number) {
    return [active && `${active} active`, done && `${done} done`].filter(Boolean).join(', ');
}

/** The clients of the projects the person can see, each opening the projects list filtered to it */
export default async function ClientsPage() {
    const context = await requireAppContext();
    const canEdit = context.isAdmin && context.workspace.id !== PUBLIC_WORKSPACE_ID;
    // Projects first: listing them moves older client names to client documents
    const projects = await listVisibleProjects(context);
    const clients = projectClients(projects, await loadClients(context.workspace.id));

    return (
        <>
            <PageHeader
                title="Clients"
                description="Who your projects are for. Set a project's client when you create it or in its settings." />
            {clients.length ? (
                <Card className="gap-0 py-0">
                    <ItemGroup aria-label="Clients" className="gap-0 divide-y">
                        {clients.map(client => {
                            const active = client.projects.filter(project => project.status !== 'done').length;
                            const done = client.projects.length - active;
                            const { projects: _, ...summary } = client;
                            return (
                                <div key={client.id} role="listitem">
                                    <Item className="relative rounded-none has-[a:hover]:bg-muted">
                                        <ItemMedia className="group-has-data-[slot=item-description]/item:translate-y-0 group-has-data-[slot=item-description]/item:self-center">
                                            <ClientMark client={client} className="size-8 rounded-lg text-sm" />
                                        </ItemMedia>
                                        <ItemContent className="min-w-0">
                                            <ItemTitle className="max-w-full break-words">
                                                {/* The whole row opens the client's projects; done-only clients open the done ones, so the list is never empty. The edit button sits above the link. */}
                                                <Link
                                                    href={KnownPageLinks.clientProjects(client.id, active ? 'active' : 'done')}
                                                    className="outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset">
                                                    {client.name}
                                                </Link>
                                            </ItemTitle>
                                            {client.description && <ItemDescription className="break-words whitespace-pre-line">{client.description}</ItemDescription>}
                                            <ItemDescription className="truncate">
                                                {client.projects.map(project => project.name).join(', ')}
                                            </ItemDescription>
                                        </ItemContent>
                                        <ItemActions className="ml-auto text-sm text-muted-foreground tabular-nums">
                                            {statusText(active, done)}
                                            {canEdit && <ClientEditDialog client={summary} className="relative z-10" />}
                                            <ChevronRightIcon aria-hidden="true" className="size-4" />
                                        </ItemActions>
                                    </Item>
                                </div>
                            );
                        })}
                    </ItemGroup>
                </Card>
            ) : (
                <Empty className="border">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <BriefcaseIcon />
                        </EmptyMedia>
                        <EmptyTitle>No clients yet</EmptyTitle>
                        <EmptyDescription>
                            {context.isAdmin
                                ? 'Add a client name to a project when you create it or in its settings.'
                                : 'Clients of the projects you are invited to show up here.'}
                        </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                        <Button variant="outline" asChild>
                            <Link href={KnownPages.AppProjects}>Go to projects</Link>
                        </Button>
                    </EmptyContent>
                </Empty>
            )}
        </>
    );
}
