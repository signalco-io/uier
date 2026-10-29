'use client';

import { useActionState, useEffect, useState } from 'react';
import { TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/src/components/ui/alert';
import { Button } from '@/src/components/ui/button';
import { CardContent, CardDescription, CardFooter, CardHeader } from '@/src/components/ui/card';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/src/components/ui/item';
import { RadioGroup } from '@/src/components/ui/radio-group';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { Spinner } from '@/src/components/ui/spinner';
import type { AgentAccess, ClientPresentation } from '@/src/lib/mcp/oauth/grants';
import type { McpScope } from '@/src/lib/mcp/scopes';
import { approveConnectionAction, cancelConnectionAction, switchConnectionAccountAction } from '@/src/lib/mcp/oauth/actions';
import { ChoiceCard } from '../ChoiceCard';
import { FormMessage } from '../FormMessage';
import { ClientHosts, ClientName, ClientNotices } from './ClientDetails';
import { scopeOptions } from './scopes';

export type ConsentWorkspace = {
    id: string;
    name: string;
    /** `guests`: people outside the workspace can comment (a guest link, or uier's public feedback) */
    projects: { id: string; name: string; guests: boolean }[];
};

/** An existing connection to replace: offered for the same client, required at the connection limit */
export type ConsentReplace =
    | { mode: 'optional'; app: { id: string; name: string }; checked: boolean }
    | { mode: 'required'; apps: { id: string; name: string }[]; defaultId?: string; limit: number };

type Selection = Record<string, 'all' | string[]>;

/** What the consent page needs from a pending request (docs/mcp-oauth-plan.md §8) */
export type ConsentRequest = {
    email: string;
    client: ClientPresentation;
    requestedScopes: McpScope[];
    workspaces: ConsentWorkspace[];
    truncated: boolean;
    replace: ConsentReplace | null;
};

type Outcome = { approved: boolean; url: string | null };

/**
 * The consent page for a coding tool's OAuth sign-in. `request` is null when the request is unknown,
 * expired or used. The page renders this component either way, so the outcome survives the refresh
 * that follows a server action (the request is consumed by then) and the page can send the person back.
 */
export function ConnectConsent({ requestId, request }: { requestId: string; request: ConsentRequest | null }) {
    const [clientName] = useState(request?.client.name ?? 'your coding tool');
    const [outcome, setOutcome] = useState<Outcome | null>(null);
    useEffect(() => {
        // Not a redirect from the form post: `form-action 'self'` would block the client's callback.
        if (outcome?.url)
            window.location.assign(outcome.url);
    }, [outcome]);

    if (outcome?.url)
        return <>
            <CardHeader>
                <h1 className="m-0 text-xl leading-7 font-semibold tracking-[-0.015em] break-words">Returning to {clientName}</h1>
                <CardDescription role="status">{outcome.approved ? 'Access allowed.' : 'Access not allowed.'} You can close this tab.</CardDescription>
            </CardHeader>
            <CardContent>
                <p className="m-0 text-sm text-muted-foreground">If nothing happens, use this link.</p>
            </CardContent>
            <CardFooter>
                <Button asChild variant="outline"><a href={outcome.url}>Return to {clientName}</a></Button>
            </CardFooter>
        </>;
    if (outcome || !request)
        return <ExpiredRequest />;
    return <ConsentForm requestId={requestId} request={request} onOutcome={setOutcome} />;
}

function ConsentForm({ requestId, request: { email, client, requestedScopes, workspaces, truncated, replace }, onOutcome }: {
    requestId: string;
    request: ConsentRequest;
    onOutcome: (outcome: Outcome) => void;
}) {
    const [accessKind, setAccessKind] = useState<'all' | 'selected'>('all');
    const [selection, setSelection] = useState<Selection>({});
    const [scopes, setScopes] = useState<McpScope[]>(() => [...new Set<McpScope>(['feedback:read', ...requestedScopes])]);
    const [name, setName] = useState(client.name);
    const [replaceChecked, setReplaceChecked] = useState(replace?.mode === 'optional' ? replace.checked : false);
    const [replaceId, setReplaceId] = useState(replace?.mode === 'required' ? replace.defaultId ?? '' : '');

    const chosen = workspaces.filter(workspace => selection[workspace.id] === 'all' || (selection[workspace.id]?.length ?? 0) > 0);
    const access: AgentAccess = accessKind === 'all'
        ? { kind: 'all' }
        : { kind: 'selected', workspaces: chosen.map(workspace => ({ workspaceId: workspace.id, projects: selection[workspace.id]! })) };
    const replaceGrantId = replace?.mode === 'optional' ? (replaceChecked ? replace.app.id : undefined) : (replaceId || undefined);

    const [approval, approve, approving] = useActionState(async () => {
        const result = await approveConnectionAction(requestId, { access, scopes, name, ...(replaceGrantId ? { replaceGrantId } : {}) });
        if (result?.ok) onOutcome({ approved: true, url: result.data.url });
        return result;
    }, null);
    const [cancellation, cancel, cancelling] = useActionState(async () => {
        const result = await cancelConnectionAction(requestId);
        if (result?.ok) onOutcome({ approved: false, url: result.data.url });
        return result;
    }, null);

    const writes = scopes.some(scope => scopeOptions.some(option => option.scope === scope && option.write));
    const guestProjects = chosen.some(workspace => workspace.projects.some(project =>
        project.guests && (selection[workspace.id] === 'all' || (selection[workspace.id] as string[]).includes(project.id))));
    const broad = accessKind === 'all' || chosen.length > 1 || guestProjects;
    const pending = approving || cancelling;

    const setWorkspace = (workspaceId: string, projects: 'all' | string[] | undefined) =>
        setSelection(previous => {
            const next = { ...previous };
            if (projects === undefined || (Array.isArray(projects) && !projects.length))
                delete next[workspaceId];
            else
                next[workspaceId] = projects;
            return next;
        });
    const toggleProject = (workspaceId: string, projectId: string, checked: boolean) => {
        const current = selection[workspaceId];
        const list = Array.isArray(current) ? current : [];
        setWorkspace(workspaceId, checked ? [...list, projectId] : list.filter(id => id !== projectId));
    };

    return (
        <>
            <CardHeader>
                <h1 className="m-0 text-xl leading-7 font-semibold tracking-[-0.015em] break-words">Connect {client.name} to uier</h1>
                <CardDescription>
                    <span className="flex flex-wrap items-center gap-x-2">
                        <span>Signed in as <span className="font-mono text-[13px] break-all">{email}</span>.</span>
                        <form action={switchConnectionAccountAction.bind(null, requestId)}>
                            <Button type="submit" variant="link" className="h-auto p-0 underline">Use another account</Button>
                        </form>
                    </span>
                </CardDescription>
            </CardHeader>
            <form action={approve} className="contents">
                <CardContent className="gap-6">
                    <div className="flex flex-col gap-3">
                        <Item variant="outline" role="group" aria-label="App">
                            <ItemContent>
                                <ItemTitle className="line-clamp-none"><ClientName client={client} /></ItemTitle>
                                <ItemDescription className="line-clamp-none"><ClientHosts client={client} /></ItemDescription>
                            </ItemContent>
                        </Item>
                        <ClientNotices client={client} />
                    </div>
                    <FieldGroup>
                        <FieldSet>
                            <FieldLegend>What it can reach</FieldLegend>
                            <FieldDescription>Your current access in uier always applies. Removing you from a workspace or project removes it here too.</FieldDescription>
                            <RadioGroup value={accessKind} onValueChange={value => setAccessKind(value as 'all' | 'selected')} aria-label="What it can reach">
                                <ChoiceCard id="access-all" value="all" title="All my workspaces and projects, including new ones"
                                    description="Every workspace and project you can open in uier, now and later." />
                                <ChoiceCard id="access-selected" value="selected" title="Choose workspaces and projects"
                                    description="Only the workspaces and projects you pick below." />
                            </RadioGroup>
                            {accessKind === 'selected' && <div className="flex flex-col gap-4">
                                {workspaces.map(workspace => {
                                    const value = selection[workspace.id];
                                    return (
                                        <div key={workspace.id} className="rounded-lg border p-4">
                                            <FieldSet className="gap-3">
                                                <FieldLegend variant="label" className="break-words">{workspace.name}</FieldLegend>
                                                <Field orientation="horizontal">
                                                    <Checkbox id={`workspace-${workspace.id}`} checked={value === 'all'}
                                                        onCheckedChange={checked => setWorkspace(workspace.id, checked === true ? 'all' : undefined)} />
                                                    <FieldLabel htmlFor={`workspace-${workspace.id}`} className="font-normal">All projects, including new ones</FieldLabel>
                                                </Field>
                                                {value !== 'all' && workspace.projects.map(project => (
                                                    <Field key={project.id} orientation="horizontal">
                                                        <Checkbox id={`project-${project.id}`} checked={Array.isArray(value) && value.includes(project.id)}
                                                            onCheckedChange={checked => toggleProject(workspace.id, project.id, checked === true)} />
                                                        <FieldLabel htmlFor={`project-${project.id}`} className="font-normal break-words">{project.name}</FieldLabel>
                                                    </Field>
                                                ))}
                                                {!workspace.projects.length && <FieldDescription>No projects you can open yet.</FieldDescription>}
                                            </FieldSet>
                                        </div>
                                    );
                                })}
                                {truncated && <FieldDescription>Some workspaces are not listed here. Choose all workspaces and projects to include them.</FieldDescription>}
                            </div>}
                        </FieldSet>
                        <FieldSet className="gap-4">
                            <FieldLegend>What it can do</FieldLegend>
                            <div className="-mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                                <FieldDescription>{client.name} asked for the operations selected here.</FieldDescription>
                                <Button type="button" variant="outline" size="sm" disabled={scopes.length === scopeOptions.length}
                                    onClick={() => setScopes(scopeOptions.map(option => option.scope))}>Select all operations</Button>
                            </div>
                            <FieldGroup className="gap-3">
                                {scopeOptions.map(option => {
                                    const required = option.scope === 'feedback:read';
                                    return (
                                        <Field key={option.scope} orientation="horizontal" data-disabled={required || undefined}>
                                            <Checkbox id={`scope-${option.scope}`} checked={scopes.includes(option.scope)} disabled={required}
                                                aria-describedby={`scope-${option.scope}-description`}
                                                onCheckedChange={checked => setScopes(previous => checked === true
                                                    ? [...previous, option.scope] : previous.filter(scope => scope !== option.scope))} />
                                            <FieldContent>
                                                <FieldLabel htmlFor={`scope-${option.scope}`}>{option.label}</FieldLabel>
                                                <FieldDescription id={`scope-${option.scope}-description`}>
                                                    {option.description}{required ? ' Always included.' : ''}
                                                </FieldDescription>
                                            </FieldContent>
                                        </Field>
                                    );
                                })}
                            </FieldGroup>
                        </FieldSet>
                        {writes && broad && <Alert>
                            <TriangleAlertIcon />
                            <AlertTitle>Feedback can contain instructions from people outside your team.</AlertTitle>
                            <AlertDescription>Approve every reply, status change and assignment in your coding tool.</AlertDescription>
                        </Alert>}
                        <Field>
                            <FieldLabel htmlFor="connection-name">Connection name</FieldLabel>
                            <Input id="connection-name" value={name} onChange={event => setName(event.target.value)} required maxLength={60}
                                autoComplete="off" aria-describedby="connection-name-description" />
                            <FieldDescription id="connection-name-description">Replies and status changes from this app show this name.</FieldDescription>
                        </Field>
                        {replace?.mode === 'optional' && <Field orientation="horizontal">
                            <Checkbox id="replace" checked={replaceChecked} onCheckedChange={checked => setReplaceChecked(checked === true)}
                                aria-describedby="replace-description" />
                            <FieldContent>
                                <FieldLabel htmlFor="replace" className="break-words">Replace {replace.app.name}</FieldLabel>
                                <FieldDescription id="replace-description">The earlier connection stops working when this one starts.</FieldDescription>
                            </FieldContent>
                        </Field>}
                        {replace?.mode === 'required' && <Field>
                            <FieldLabel htmlFor="replace">Connection to replace</FieldLabel>
                            <Select value={replaceId} onValueChange={setReplaceId}>
                                <SelectTrigger id="replace" aria-describedby="replace-description"><SelectValue placeholder="Choose a connection" /></SelectTrigger>
                                <SelectContent><SelectGroup>
                                    {replace.apps.map(app => <SelectItem key={app.id} value={app.id}>{app.name}</SelectItem>)}
                                </SelectGroup></SelectContent>
                            </Select>
                            <FieldDescription id="replace-description">You have {replace.limit} connected apps, the most uier allows. Choose one to replace, or revoke one in Account first.</FieldDescription>
                        </Field>}
                        <FormMessage state={approval ?? cancellation} />
                    </FieldGroup>
                </CardContent>
                <CardFooter className="flex-wrap justify-end gap-3 border-t">
                    <Button type="submit" variant="outline" formAction={cancel} formNoValidate disabled={pending}>
                        {cancelling && <Spinner data-icon="inline-start" />}
                        Cancel
                    </Button>
                    <Button type="submit" disabled={pending}>
                        {approving && <Spinner data-icon="inline-start" />}
                        Allow access
                    </Button>
                </CardFooter>
            </form>
        </>
    );
}

/** An unknown, expired or used request: the coding tool has to start a new one */
export function ExpiredRequest() {
    return (
        <CardHeader>
            <h1 className="m-0 text-xl leading-7 font-semibold tracking-[-0.015em]">Start again from your coding tool</h1>
            <CardDescription>This sign-in request has expired or was already used. Requests last 10 minutes. Connect again from your coding tool to get a new one.</CardDescription>
        </CardHeader>
    );
}
