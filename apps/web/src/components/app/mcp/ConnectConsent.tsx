'use client';

import { useActionState, useEffect, useState } from 'react';
import { TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/src/components/ui/alert';
import { Button, buttonVariants } from '@/src/components/ui/button';
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
import { PersonAvatar } from '../PersonAvatar';
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
type AccountSelection = { included: boolean; kind: 'all' | 'selected'; workspaces: Selection };

export type ConsentAccount = {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string;
    workspaces: ConsentWorkspace[];
    truncated: boolean;
};

/** What the consent page needs from a pending request (docs/mcp-oauth-plan.md §8) */
export type ConsentRequest = {
    userId: string;
    email: string;
    client: ClientPresentation;
    requestedScopes: McpScope[];
    accounts: ConsentAccount[];
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
                <a href={outcome.url} className={buttonVariants({ variant: 'outline' })}>Return to {clientName}</a>
            </CardFooter>
        </>;
    if (outcome || !request)
        return <ExpiredRequest />;
    return <ConsentForm requestId={requestId} request={request} onOutcome={setOutcome} />;
}

function ConsentForm({ requestId, request: { userId, email, client, requestedScopes, accounts, replace }, onOutcome }: {
    requestId: string;
    request: ConsentRequest;
    onOutcome: (outcome: Outcome) => void;
}) {
    const [selections, setSelections] = useState<Record<string, AccountSelection>>(() => Object.fromEntries<AccountSelection>(accounts.map(account => [account.id, {
        included: account.id === userId, kind: 'all', workspaces: {}
    }])));
    const [scopes, setScopes] = useState<McpScope[]>(() => [...new Set<McpScope>(['feedback:read', ...requestedScopes.filter(scope => scope !== 'tokens:create')])]);
    const [name, setName] = useState(client.name);
    const [replaceChecked, setReplaceChecked] = useState(replace?.mode === 'optional' ? replace.checked : false);
    const [replaceId, setReplaceId] = useState(replace?.mode === 'required' ? replace.defaultId ?? '' : '');

    const selectedAccounts = accounts.filter(account => selections[account.id]?.included);
    const choices = selectedAccounts.map(account => ({ userId: account.id, access: accountAccess(account, selections[account.id]!) }));
    const replaceGrantId = replace?.mode === 'optional' ? (replaceChecked ? replace.app.id : undefined) : (replaceId || undefined);

    const [approval, approve, approving] = useActionState(async () => {
        const result = await approveConnectionAction(requestId, userId, { accounts: choices, scopes, name, ...(replaceGrantId ? { replaceGrantId } : {}) });
        if (result?.ok) onOutcome({ approved: true, url: result.data.url });
        return result;
    }, null);
    const [cancellation, cancel, cancelling] = useActionState(async () => {
        const result = await cancelConnectionAction(requestId);
        if (result?.ok) onOutcome({ approved: false, url: result.data.url });
        return result;
    }, null);

    const writes = scopes.some(scope => scopeOptions.some(option => option.scope === scope && option.write));
    const broad = selectedAccounts.length > 1 || selectedAccounts.some(account => {
        const choice = selections[account.id]!;
        const chosen = account.workspaces.filter(workspace => choice.workspaces[workspace.id] === 'all' || (choice.workspaces[workspace.id]?.length ?? 0) > 0);
        return choice.kind === 'all' || chosen.length > 1 || chosen.some(workspace => workspace.projects.some(project =>
            project.guests && (choice.workspaces[workspace.id] === 'all' || (choice.workspaces[workspace.id] as string[]).includes(project.id))));
    });
    const pending = approving || cancelling;
    const validChoices = choices.length > 0 && choices.every(choice => choice.access.kind === 'all' || choice.access.workspaces.length > 0);

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
                            <FieldDescription>Choose the accounts to include, then what each account can reach. Your current permissions always apply.</FieldDescription>
                            <FieldDescription>This connection is managed from <span className="font-mono text-[13px] break-all">{email}</span>. Switching accounts or signing out in this browser keeps the connection active.</FieldDescription>
                            {accounts.map(account => <AccountAccessChoice key={account.id} account={account} value={selections[account.id]!}
                                onChange={value => setSelections(previous => ({ ...previous, [account.id]: value }))} />)}
                        </FieldSet>
                        <FieldSet className="gap-4">
                            <FieldLegend>What it can do</FieldLegend>
                            <div className="-mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                                <FieldDescription>{client.name} asked for the operations selected here. Create access tokens is off by default, even when requested.</FieldDescription>
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
                            <Select items={replace.apps.map(app => ({ value: app.id, label: app.name }))} value={replaceId} onValueChange={value => value !== null && setReplaceId(value)}>
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
                    <Button type="submit" disabled={pending || !validChoices}>
                        {approving && <Spinner data-icon="inline-start" />}
                        Allow access
                    </Button>
                </CardFooter>
            </form>
        </>
    );
}

function accountAccess(account: ConsentAccount, choice: AccountSelection): AgentAccess {
    return choice.kind === 'all'
        ? { kind: 'all' }
        : { kind: 'selected', workspaces: account.workspaces.filter(workspace => choice.workspaces[workspace.id] === 'all'
            || (choice.workspaces[workspace.id]?.length ?? 0) > 0)
            .map(workspace => ({ workspaceId: workspace.id, projects: choice.workspaces[workspace.id]! })) };
}

/** Each selected profile has its own scope; selecting it never changes the browser's active account. */
function AccountAccessChoice({ account, value, onChange }: {
    account: ConsentAccount;
    value: AccountSelection;
    onChange: (value: AccountSelection) => void;
}) {
    const setWorkspace = (workspaceId: string, projects: 'all' | string[] | undefined) => {
        const workspaces = { ...value.workspaces };
        if (projects === undefined || (Array.isArray(projects) && !projects.length)) delete workspaces[workspaceId];
        else workspaces[workspaceId] = projects;
        onChange({ ...value, workspaces });
    };
    const toggleProject = (workspaceId: string, projectId: string, checked: boolean) => {
        const current = value.workspaces[workspaceId];
        const list = Array.isArray(current) ? current : [];
        setWorkspace(workspaceId, checked ? [...list, projectId] : list.filter(id => id !== projectId));
    };
    return (
        <FieldSet aria-label={account.email} className="rounded-lg border p-4">
            <Field orientation="horizontal">
                <Checkbox id={`account-${account.id}`} aria-label={`Include ${account.email}`} checked={value.included}
                    onCheckedChange={included => onChange({ ...value, included: included === true })} />
                <PersonAvatar name={account.name} avatarUrl={account.avatarUrl} className="size-8" />
                <FieldContent>
                    <FieldLabel htmlFor={`account-${account.id}`} className="break-words">{account.name}</FieldLabel>
                    <FieldDescription className="font-mono text-[13px] break-all">{account.email}</FieldDescription>
                </FieldContent>
            </Field>
            {value.included && <>
                <RadioGroup value={value.kind} onValueChange={kind => onChange({ ...value, kind: kind as 'all' | 'selected' })} aria-label="What it can reach">
                    <ChoiceCard id={`access-all-${account.id}`} value="all" title="All my workspaces and projects, including new ones"
                        description="Every workspace and project this account can open in uier, now and later." />
                    <ChoiceCard id={`access-selected-${account.id}`} value="selected" title="Choose workspaces and projects"
                        description="Only the workspaces and projects you pick below." />
                </RadioGroup>
                {value.kind === 'selected' && <FieldGroup className="gap-4">
                    {account.workspaces.map(workspace => {
                        const projects = value.workspaces[workspace.id];
                        return (
                            <FieldSet key={workspace.id} className="gap-3 rounded-lg border p-4">
                                <FieldLegend variant="label" className="break-words">{workspace.name}</FieldLegend>
                                <Field orientation="horizontal">
                                    <Checkbox id={`workspace-${account.id}-${workspace.id}`} checked={projects === 'all'}
                                        onCheckedChange={checked => setWorkspace(workspace.id, checked === true ? 'all' : undefined)} />
                                    <FieldLabel htmlFor={`workspace-${account.id}-${workspace.id}`} className="font-normal">All projects, including new ones</FieldLabel>
                                </Field>
                                {projects !== 'all' && workspace.projects.map(project => (
                                    <Field key={project.id} orientation="horizontal">
                                        <Checkbox id={`project-${account.id}-${project.id}`} checked={Array.isArray(projects) && projects.includes(project.id)}
                                            onCheckedChange={checked => toggleProject(workspace.id, project.id, checked === true)} />
                                        <FieldLabel htmlFor={`project-${account.id}-${project.id}`} className="font-normal break-words">{project.name}</FieldLabel>
                                    </Field>
                                ))}
                                {!workspace.projects.length && <FieldDescription>No projects you can open yet.</FieldDescription>}
                            </FieldSet>
                        );
                    })}
                    {account.truncated && <FieldDescription>Some workspaces are not listed here. Choose all workspaces and projects for this account to include them.</FieldDescription>}
                </FieldGroup>}
            </>}
        </FieldSet>
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
