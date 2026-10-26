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
import { projectClients } from '@/src/lib/app/clients';
import { PageHeader } from '@/src/components/app/PageHeader';
import { ProjectMark } from '@/src/components/app/projects/ProjectMark';

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
    const clients = projectClients(await listVisibleProjects(context));

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
                            return (
                                <div key={client.name} role="listitem">
                                    <Item asChild className="rounded-none">
                                        {/* Done-only clients open the done projects, so the list is never empty */}
                                        <Link href={KnownPageLinks.clientProjects(client.name, active ? 'active' : 'done')}>
                                            <ItemMedia className="group-has-data-[slot=item-description]/item:translate-y-0 group-has-data-[slot=item-description]/item:self-center">
                                                <ProjectMark name={client.name} className="size-8 rounded-lg text-sm" />
                                            </ItemMedia>
                                            <ItemContent className="min-w-0">
                                                <ItemTitle className="max-w-full break-words">{client.name}</ItemTitle>
                                                <ItemDescription className="truncate">
                                                    {client.projects.map(project => project.name).join(', ')}
                                                </ItemDescription>
                                            </ItemContent>
                                            <ItemActions className="ml-auto text-sm text-muted-foreground tabular-nums">
                                                {statusText(active, done)}
                                                <ChevronRightIcon aria-hidden="true" className="size-4" />
                                            </ItemActions>
                                        </Link>
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
