'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FoldersIcon } from 'lucide-react';
import { useAppI18n } from '@/src/lib/i18n/client';
import type { ClientSummary } from '@/src/lib/app/clients';
import { KnownPages } from '@/src/knownPages';
import { buttonVariants } from '@/src/components/ui/button';
import { PopoverDescription, PopoverHeader, PopoverTitle } from '@/src/components/ui/popover';
import { Skeleton } from '@/src/components/ui/skeleton';
import { cn } from '@/src/lib/utils';
import { LinkPopover } from '../LinkPopover';
import { projectClientProjectsAction } from '../projects/headerActions';
import { ClientMark } from './ClientMark';
import { clientStatusText } from './clientStatusText';

type ProjectsState = { status: 'loading' } | { status: 'error' } | { status: 'loaded'; counts: { active: number; done: number } | null };

/**
 * A project's client in its header (uier #421): a link to the projects list filtered to the client
 * (`href`), with more about the client in a popover on hover or focus (a tap on a touch screen opens
 * it): its description, how many of its projects are active and done (loaded when it opens), and the
 * way to its projects and to all clients.
 */
export function ClientInfo({ client, projectId, href }: { client: ClientSummary; projectId: string; href: string }) {
    const { t } = useAppI18n();
    const [state, setState] = useState<ProjectsState>({ status: 'loading' });

    function loadProjects() {
        setState(current => current.status === 'loaded' ? current : { status: 'loading' });
        projectClientProjectsAction(projectId).then(
            counts => setState({ status: 'loaded', counts }),
            () => setState(current => current.status === 'loaded' ? current : { status: 'error' }));
    }

    const projects = state.status === 'loaded' && state.counts ? clientStatusText(state.counts.active, state.counts.done, t) : '';
    return (
        <LinkPopover
            href={href}
            label={`${t("Client:")} ${client.name}`}
            onOpen={loadProjects}
            className="min-w-0"
            trigger={(
                <>
                    <ClientMark client={client} />
                    <span className="min-w-0 break-words">{t("Client:")}{' '}{client.name}</span>
                </>
            )}>
            <div className="flex items-start gap-3">
                <ClientMark client={client} className="size-10 rounded-lg text-base" />
                <PopoverHeader className="min-w-0 flex-1 gap-0.5">
                    <PopoverTitle className="break-words">{client.name}</PopoverTitle>
                    <PopoverDescription>{t("Client")}</PopoverDescription>
                </PopoverHeader>
            </div>
            {client.description && <p className="m-0 line-clamp-4 text-sm break-words whitespace-pre-line">{client.description}</p>}
            {/* One line for the placeholder and the counts, so the popover keeps its size when they load */}
            {state.status !== 'loaded' || projects ? (
                <div className="flex h-5 items-center gap-2 text-sm">
                    <FoldersIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                    {state.status === 'loading' ? (
                        <Skeleton role="status" aria-label={t("Loading projects")} className="h-4 w-28" />
                    ) : state.status === 'error' ? (
                        <span className="text-muted-foreground">{t("Could not load projects.")}</span>
                    ) : (
                        <span className="tabular-nums">
                            <span className="sr-only">{t("Projects")}: </span>{projects}
                        </span>
                    )}
                </div>
            ) : null}
            <div className="flex gap-2">
                <Link href={href} className={cn(buttonVariants({ variant: 'outline' }), 'flex-1')}>{t("Show projects")}</Link>
                <Link href={KnownPages.AppClients} className={cn(buttonVariants({ variant: 'ghost' }), 'flex-1')}>{t("All clients")}</Link>
            </div>
        </LinkPopover>
    );
}
