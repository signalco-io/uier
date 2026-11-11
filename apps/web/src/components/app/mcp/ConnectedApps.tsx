'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useState, useTransition } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/src/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/src/components/ui/collapsible';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/src/components/ui/empty';
import { ItemGroup } from '@/src/components/ui/item';
import { Spinner } from '@/src/components/ui/spinner';
import type { ActionState } from '@/src/lib/app/actionResult';
import { revokeConnectedAppAction } from '@/src/lib/mcp/oauth/actions';
import type { ConnectedAppView } from '@/src/lib/mcp/oauth/connectedApps';
import { cn } from '@/src/lib/utils';
import { AgentAvatar } from '../comments/AgentAvatar';
import { RelativeTime } from '../comments/DateTime';
import { FormMessage } from '../FormMessage';
import { Section } from '../PageHeader';
import { ClientHosts, ClientName } from './ClientDetails';
import { ConnectionAvatar, ConnectionItem, ConnectionReach, factsClassName, ScopeBadges } from './ConnectionSummary';

/** Account: the apps connected with OAuth sign-in, one row per grant, each revocable */
export function ConnectedApps({ apps }: { apps: ConnectedAppView[] }) {
    const { t, language } = useAppI18n();
    return (
        <Section id="connected-apps" title={t("Connected apps")}
            description={t("Coding tools you allowed when they asked you to sign in. Your current project permissions always apply.")}>
            {apps.length
                ? <ItemGroup aria-label={t("Connected apps")} className="gap-3">
                    {apps.map(app => <ConnectedAppRow key={app.id} app={app} />)}
                </ItemGroup>
                : <NoConnectedApps />}
            <p className="m-0 text-xs text-muted-foreground">{t("An app keeps access while it is used, for up to one year, and loses it after 30 days without use. Revoking ends its access on its next request. Feedback it already received stays with it.")}</p>
        </Section>
    );
}

/** Nothing connected yet: what shows up here, and the way to the setup below */
function NoConnectedApps() {
    const { t, language } = useAppI18n();
    return (
        <Empty className="gap-5 border p-8">
            <EmptyHeader>
                <EmptyMedia aria-hidden="true" className="flex -space-x-2">
                    {(['claude', 'codex', 'cursor'] as const).map(kind => <AgentAvatar key={kind} kind={kind} className="size-9 ring-2 ring-card" />)}
                </EmptyMedia>
                <EmptyTitle className="text-base">{t("No connected apps yet")}</EmptyTitle>
                <EmptyDescription>{t("When a coding tool such as Claude Code signs in with your browser, it shows up here with what it can reach and do.")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
                <a href="#connect" className={buttonVariants({ variant: 'outline' })}>{t("Connect a coding tool")}</a>
            </EmptyContent>
        </Empty>
    );
}

function ConnectedAppRow({ app }: { app: ConnectedAppView }) {
    const { t, language } = useAppI18n();
    const [revokeTokens, setRevokeTokens] = useState(true);
    const [confirming, setConfirming] = useState(false);
    const [state, setState] = useState<ActionState>(null);
    const [pending, startTransition] = useTransition();
    const revoke = () => startTransition(async () => {
        const result = await revokeConnectedAppAction(app.id, revokeTokens);
        setState(result);
        if (result?.ok)
            setConfirming(false);
    });
    return (
        <ConnectionItem avatar={<ConnectionAvatar hints={[app.client.name, app.client.metadataHost, app.name]} />}
            title={<ClientName client={app.client} name={app.name} />}
            description={<>
                {app.client.name !== app.name && <span>{t("App:")}{' '}{app.client.name}</span>}
                <ClientHosts client={app.client} />
            </>}
            actions={<AlertDialog open={confirming} onOpenChange={open => { setConfirming(open); if (open) setRevokeTokens(true); }}>
                <AlertDialogTrigger render={<Button variant="ghost" size="sm" aria-label={t("Revoke {value1}", { value1: app.name })} />}>{"Revoke"}</AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="break-words">{"Revoke"}{' '}{app.name}?</AlertDialogTitle>
                        <AlertDialogDescription>{"It loses access to uier on its next request. Feedback it already received stays with it. To use it again, connect it again from your coding tool."}</AlertDialogDescription>
                    </AlertDialogHeader>
                    {app.activeCreatedTokenCount > 0 && <div className="flex flex-col gap-2 text-sm">
                        <p className="m-0">{"This connection created"}{' '}{app.activeCreatedTokenCount} {"active access"}{' '}{app.activeCreatedTokenCount === 1 ? "token" : "tokens"}{". These are separate and listed under Access tokens. Unchecked tokens keep access until their expiry or revocation."}</p>
                        <label className="flex items-center gap-2">
                            <Checkbox checked={revokeTokens} onCheckedChange={setRevokeTokens} disabled={pending} />
                            {"Also revoke the"}{' '}{app.activeCreatedTokenCount} {"access"}{' '}{app.activeCreatedTokenCount === 1 ? "token it created" : "tokens it created"}
                        </label>
                    </div>}
                    <FormMessage state={state} />
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={pending}>{"Keep connected"}</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" disabled={pending} onClick={() => revoke()}>
                            {pending && <Spinner data-icon="inline-start" />}
                            {"Revoke"}{' '}</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>}>
            <ConnectionReach>
                {app.access.all
                    ? app.access.summary
                    : <Collapsible>
                        <p className="m-0 flex flex-wrap items-center gap-x-2">
                            <span>{app.access.summary}</span>
                            <CollapsibleTrigger render={<Button variant="link" size="sm" className="group h-auto p-0" />}>
                                {t("Details")}<span className="sr-only"> {t("for")}{' '}{app.name}</span>
                                <ChevronDownIcon data-icon="inline-end" className="transition-transform group-aria-expanded:rotate-180" />
                            </CollapsibleTrigger>
                        </p>
                        <CollapsibleContent>
                            {app.access.accounts
                                ? <ul className="m-0 mt-2 flex list-none flex-col gap-3 border-l pl-3 text-muted-foreground">
                                    {app.access.accounts.map((account, index) => <li key={index} className="break-words">
                                        <span className="font-mono text-[13px] text-foreground break-all">{t(account.label)}</span>
                                        <p className="m-0">{account.summary}</p>
                                        {!account.all && <WorkspaceAccessDetails workspaces={account.workspaces} />}
                                    </li>)}
                                </ul>
                                : <WorkspaceAccessDetails workspaces={app.access.workspaces} />}
                        </CollapsibleContent>
                    </Collapsible>}
            </ConnectionReach>
            <ScopeBadges scopes={app.scopes} />
            <p className={cn('m-0 text-xs text-muted-foreground', factsClassName)}>
                <span>{t("Connected")}{' '}<RelativeTime value={app.createdAt} /></span>
                <span>{app.lastUsedAt ? <>{t("Last used")}{' '}<RelativeTime value={app.lastUsedAt} /></> : t("Not used yet")}</span>
                <span>{t("Expires")}{' '}<RelativeTime value={app.expiresAt} /></span>
            </p>
        </ConnectionItem>
    );
}

function WorkspaceAccessDetails({ workspaces }: { workspaces: ConnectedAppView['access']['workspaces'] }) {
    return (
        <ul className="m-0 mt-2 flex list-none flex-col gap-1 border-l pl-3 text-muted-foreground">
            {workspaces.map((workspace, index) => <li key={index} className="break-words">
                <span className="text-foreground">{workspace.name}</span>{workspace.projects && `: ${workspace.projects}`}
            </li>)}
        </ul>
    );
}
