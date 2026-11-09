'use client';

import { useActionState, useId, useState, useTransition } from 'react';
import { AtSignIcon, LogInIcon, PlusIcon } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/src/components/ui/alert-dialog';
import { Button } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/src/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/src/components/ui/field';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/src/components/ui/item';
import { Spinner } from '@/src/components/ui/spinner';
import { Section } from '@/src/components/app/PageHeader';
import { FormMessage } from '@/src/components/app/FormMessage';
import { signInAgainWithEmailAction } from '@/src/components/app/shell/actions';
import { KnownPages } from '@/src/knownPages';
import type { ActionState } from '@/src/lib/app/actionResult';
import { DOMAIN_ADD_SIGN_IN_AGAIN } from '@/src/lib/app/emailProof';
import { addDomainAction, removeDomainAction, updateDomainTeamsAction } from './domainActions';

type Team = { id: string; name: string };

export type WorkspaceDomainView = {
    domain: string;
    /** The teams people who join get (only those that still apply) */
    teams: Team[];
    addedByName?: string;
};

/** "a", "a and b", "a, b and c" */
function list(items: string[]) {
    return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/**
 * Workspace settings: the email domains whose people can join the workspace with a click after they sign
 * in (`workspaceDomains.ts`). An admin can add only the domain of their own email, which is suggested, and
 * only with a sign-in from the last 10 minutes that proved that email (`emailProof.ts`); otherwise the
 * section offers to sign in again with the email.
 */
export function WorkspaceDomains({ domains, teams, suggestion, ownDomain, signInAgain }: {
    domains: WorkspaceDomainView[];
    teams: Team[];
    /** The admin's own email domain when they can add it */
    suggestion: string | null;
    /** The admin's own email domain, to explain why it can't be added */
    ownDomain: string | null;
    /** This browser's sign-in proved no email in the last 10 minutes */
    signInAgain: boolean;
}) {
    // Also when adding fails because the proof ran out while the page was open
    const [expired, setExpired] = useState(false);
    const needsSignIn = Boolean(suggestion) && (signInAgain || expired);
    return (
        <Section
            id="domains"
            title="Email domains"
            description="People who sign in to uier with an email at these domains can join this workspace as commenters. They join with a click; nobody is added without it."
            actions={suggestion && !needsSignIn
                ? <DomainDialog mode="add" domain={suggestion} teams={teams} onSignInAgain={() => setExpired(true)} />
                : undefined}>
            <div className="flex flex-col gap-4">
                {domains.length
                    ? (
                        <ItemGroup aria-label="Email domains" className="gap-3">
                            {domains.map(domain => <DomainRow key={domain.domain} domain={domain} teams={teams} />)}
                        </ItemGroup>
                    )
                    : <p className="m-0 text-sm text-muted-foreground">No domains yet.</p>}
                <p className="m-0 text-sm text-muted-foreground">
                    {suggestion
                        ? `You can add ${suggestion}, the domain of your email. `
                        : ownDomain && !domains.some(domain => domain.domain === ownDomain)
                            ? `${ownDomain} is a public email provider, so it can't be added. `
                            : ''}
                    An admin can add only the domain of their own email. Each domain matches exactly: add subdomains separately.
                </p>
                {needsSignIn && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
                        <p className="m-0 min-w-0 flex-1 text-sm text-muted-foreground">
                            To add {suggestion}, sign in again with your email. Adding a domain needs a sign-in from the last 10 minutes that confirms your email address.
                        </p>
                        <form action={signInAgainWithEmailAction}>
                            <input type="hidden" name="next" value={KnownPages.AppSettings} />
                            <Button type="submit" variant="outline">
                                <LogInIcon data-icon="inline-start" />
                                Sign in again
                            </Button>
                        </form>
                    </div>
                )}
            </div>
        </Section>
    );
}

function DomainRow({ domain, teams }: { domain: WorkspaceDomainView; teams: Team[] }) {
    const access = domain.teams.length
        ? `They join ${list(domain.teams.map(team => team.name))}.`
        : 'They join without project access until an admin shares projects with them.';
    return (
        <Item variant="outline" role="listitem" className="items-start">
            <ItemMedia variant="icon"><AtSignIcon /></ItemMedia>
            <ItemContent className="min-w-0">
                <ItemTitle className="line-clamp-none break-all">{domain.domain}</ItemTitle>
                <ItemDescription className="line-clamp-none break-words">
                    {access}
                    {domain.addedByName && ` Added by ${domain.addedByName}.`}
                </ItemDescription>
            </ItemContent>
            <ItemActions>
                {teams.length > 0 && <DomainDialog mode="edit" domain={domain.domain} teams={teams} selected={domain.teams.map(team => team.id)} />}
                <RemoveDomain domain={domain.domain} />
            </ItemActions>
        </Item>
    );
}

/** Adds the suggested domain, or changes a domain's teams. `onSignInAgain`: adding needs a fresh email sign-in. */
function DomainDialog({ mode, domain, teams, selected = [], onSignInAgain }: {
    mode: 'add' | 'edit';
    domain: string;
    teams: Team[];
    selected?: string[];
    onSignInAgain?: () => void;
}) {
    const [open, setOpen] = useState(false);
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={mode === 'add'
                ? <Button variant="outline" />
                : <Button variant="ghost" aria-label={`Change teams for ${domain}`} />}>
                {mode === 'add' ? <><PlusIcon data-icon="inline-start" />Add {domain}</> : 'Teams'}
            </DialogTrigger>
            <DialogContent>
                {/* Unmounted when closed, so every opening starts from the saved teams */}
                {open && <DomainForm mode={mode} domain={domain} teams={teams} selected={selected} onDone={() => setOpen(false)}
                    onSignInAgain={() => {
                        setOpen(false);
                        onSignInAgain?.();
                    }} />}
            </DialogContent>
        </Dialog>
    );
}

function DomainForm({ mode, domain, teams, selected, onDone, onSignInAgain }: {
    mode: 'add' | 'edit';
    domain: string;
    teams: Team[];
    selected: string[];
    onDone: () => void;
    onSignInAgain: () => void;
}) {
    const id = useId();
    const [state, formAction, pending] = useActionState(async (previous: ActionState, formData: FormData) => {
        const result = await (mode === 'add' ? addDomainAction : updateDomainTeamsAction)(previous, formData);
        if (result?.ok)
            onDone();
        // The section's sign-in panel explains it; no second message
        else if (result?.ok === false && result.error === DOMAIN_ADD_SIGN_IN_AGAIN)
            onSignInAgain();
        return result;
    }, null);
    const [chosen, setChosen] = useState<string[]>(selected);
    return (
        <form action={formAction} className="flex flex-col gap-6">
            <input type="hidden" name="domain" value={domain} />
            {chosen.map(teamId => <input key={teamId} type="hidden" name="team" value={teamId} />)}
            <DialogHeader>
                <DialogTitle className="break-all">{mode === 'add' ? `Add ${domain}` : `Teams for ${domain}`}</DialogTitle>
                <DialogDescription>
                    {mode === 'add'
                        ? `After they sign in, people with an email at ${domain} can join this workspace as commenters. Nobody joins without choosing to.`
                        : 'People who join from now on get these teams. People who already joined keep their access.'}
                </DialogDescription>
            </DialogHeader>
            {teams.length > 0
                ? (
                    <FieldSet>
                        <FieldLegend variant="label">Teams</FieldLegend>
                        <FieldDescription>They review every project of these teams, including projects added later.</FieldDescription>
                        <FieldGroup data-slot="checkbox-group" className="max-h-48 gap-3 overflow-y-auto">
                            {teams.map(team => (
                                <Field key={team.id} orientation="horizontal">
                                    <Checkbox
                                        id={`${id}-${team.id}`}
                                        checked={chosen.includes(team.id)}
                                        onCheckedChange={checked => setChosen(current => checked === true
                                            ? [...new Set([...current, team.id])]
                                            : current.filter(other => other !== team.id))} />
                                    <FieldLabel htmlFor={`${id}-${team.id}`} className="font-normal">{team.name}</FieldLabel>
                                </Field>
                            ))}
                        </FieldGroup>
                    </FieldSet>
                )
                : <p className="m-0 text-sm text-muted-foreground">They join without project access until an admin shares projects with them or adds them to a team.</p>}
            <FormMessage state={state} />
            <DialogFooter>
                <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
                <Button type="submit" disabled={pending}>
                    {pending && <Spinner data-icon="inline-start" />}
                    {mode === 'add' ? 'Add domain' : 'Save'}
                </Button>
            </DialogFooter>
        </form>
    );
}

function RemoveDomain({ domain }: { domain: string }) {
    const [confirming, setConfirming] = useState(false);
    const [state, setState] = useState<ActionState>(null);
    const [pending, startTransition] = useTransition();
    const remove = () => startTransition(async () => {
        const result = await removeDomainAction(domain);
        if (result?.ok) {
            setConfirming(false);
            setState(null);
        } else setState(result);
    });
    return (
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogTrigger render={<Button variant="outline" aria-label={`Remove ${domain}`} />}>Remove</AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle className="break-all">Remove {domain}?</AlertDialogTitle>
                    <AlertDialogDescription>People with an email at {domain} can no longer join on their own. People who already joined stay in the workspace.</AlertDialogDescription>
                </AlertDialogHeader>
                <FormMessage state={state} />
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending}>Keep domain</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" disabled={pending} onClick={() => remove()}>
                        {pending && <Spinner data-icon="inline-start" />}
                        Remove
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
