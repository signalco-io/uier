'use client';

import { useState, useTransition } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/src/components/ui/alert-dialog';
import { Button } from '@/src/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/src/components/ui/collapsible';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/src/components/ui/item';
import { Spinner } from '@/src/components/ui/spinner';
import type { ActionState } from '@/src/lib/app/actionResult';
import { revokeConnectedAppAction } from '@/src/lib/mcp/oauth/actions';
import type { ConnectedAppView } from '@/src/lib/mcp/oauth/connectedApps';
import { DateTime } from '../comments/DateTime';
import { FormMessage } from '../FormMessage';
import { ClientHosts, ClientName } from './ClientDetails';
import { scopeLabel } from './scopes';

/** Account: the apps connected with OAuth sign-in, one row per grant, each revocable */
export function ConnectedApps({ apps }: { apps: ConnectedAppView[] }) {
    return (
        <section aria-labelledby="connected-apps-title" className="flex flex-col gap-3">
            <h3 id="connected-apps-title" className="m-0 text-sm font-semibold">Connected apps</h3>
            <p className="m-0 text-sm text-muted-foreground">Apps you allowed when they asked you to sign in. An app keeps access while it is used, for up to one year, and loses it after 30 days without use. Revoking ends its access on its next request. Feedback it already received stays with it.</p>
            {apps.length
                ? <ItemGroup aria-label="Connected apps" className="gap-3">
                    {apps.map(app => <ConnectedAppRow key={app.id} app={app} />)}
                </ItemGroup>
                : <p className="m-0 text-sm text-muted-foreground">No connected apps yet.</p>}
        </section>
    );
}

function ConnectedAppRow({ app }: { app: ConnectedAppView }) {
    const [confirming, setConfirming] = useState(false);
    const [state, setState] = useState<ActionState>(null);
    const [pending, startTransition] = useTransition();
    const revoke = () => startTransition(async () => {
        const result = await revokeConnectedAppAction(app.id);
        setState(result);
        if (result?.ok)
            setConfirming(false);
    });
    return (
        <Item variant="outline" role="listitem" className="items-start">
            <ItemContent className="min-w-0">
                <ItemTitle className="line-clamp-none"><ClientName client={app.client} name={app.name} /></ItemTitle>
                <ItemDescription className="line-clamp-none">
                    {app.client.name !== app.name && <span className="block break-words">App: {app.client.name}</span>}
                    <ClientHosts client={app.client} />
                </ItemDescription>
                <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                    {app.access.all
                        ? <p className="m-0">{app.access.summary}</p>
                        : <Collapsible>
                            <p className="m-0 flex flex-wrap items-center gap-x-2">
                                <span>{app.access.summary}</span>
                                <CollapsibleTrigger asChild>
                                    <Button variant="link" size="sm" className="group h-auto p-0">
                                        Details<span className="sr-only"> for {app.name}</span>
                                        <ChevronDownIcon data-icon="inline-end" className="transition-transform group-aria-expanded:rotate-180" />
                                    </Button>
                                </CollapsibleTrigger>
                            </p>
                            <CollapsibleContent>
                                <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
                                    {app.access.workspaces.map((workspace, index) => <li key={index} className="break-words">
                                        <span className="text-foreground">{workspace.name}</span>{workspace.projects && `: ${workspace.projects}`}
                                    </li>)}
                                </ul>
                            </CollapsibleContent>
                        </Collapsible>}
                    <p className="m-0 break-words">{app.scopes.map(scopeLabel).join(', ')}</p>
                    <p className="m-0">
                        Connected <DateTime value={app.createdAt} />
                        {' · '}{app.lastUsedAt ? <>Last used <DateTime value={app.lastUsedAt} /></> : 'Not used yet'}
                        {' · '}Expires <DateTime value={app.expiresAt} />
                    </p>
                </div>
            </ItemContent>
            <ItemActions>
                <AlertDialog open={confirming} onOpenChange={setConfirming}>
                    <AlertDialogTrigger asChild>
                        <Button variant="outline" aria-label={`Revoke ${app.name}`}>Revoke</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle className="break-words">Revoke {app.name}?</AlertDialogTitle>
                            <AlertDialogDescription>It loses access to uier on its next request. Feedback it already received stays with it. To use it again, connect it again from your coding tool.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <FormMessage state={state} />
                        <AlertDialogFooter>
                            <AlertDialogCancel disabled={pending}>Keep connected</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" disabled={pending} onClick={event => { event.preventDefault(); revoke(); }}>
                                {pending && <Spinner data-icon="inline-start" />}
                                Revoke
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </ItemActions>
        </Item>
    );
}
