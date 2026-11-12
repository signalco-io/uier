'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
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
function list(items: string[], language: string) {
    return new Intl.ListFormat(language, { style: 'long', type: 'conjunction' }).format(items);
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
    const { t } = useAppI18n();
    // Also when adding fails because the proof ran out while the page was open
    const [expired, setExpired] = useState(false);
    const needsSignIn = Boolean(suggestion) && (signInAgain || expired);
    return (
        <Section
            id="domains"
            title={t("Email domains")}
            description={t("People who sign in to uier with an email at these domains can join this workspace as commenters. They join with a click; nobody is added without it.")}
            actions={suggestion && !needsSignIn
                ? <DomainDialog mode="add" domain={suggestion} teams={teams} onSignInAgain={() => setExpired(true)} />
                : undefined}>
            <div className="flex flex-col gap-4">
                {domains.length
                    ? (
                        <ItemGroup aria-label={t("Email domains")} className="gap-3">
                            {domains.map(domain => <DomainRow key={domain.domain} domain={domain} teams={teams} />)}
                        </ItemGroup>
                    )
                    : <p className="m-0 text-sm text-muted-foreground">{t("No domains yet.")}</p>}
                <p className="m-0 text-sm text-muted-foreground">
                    {suggestion
                        ? t("You can add {value0}, the domain of your email. ", { value0: suggestion })
                        : ownDomain && !domains.some(domain => domain.domain === ownDomain)
                            ? t("{value0} is a public email provider, so it can't be added. ", { value0: ownDomain })
                            : ''}{t("An admin can add only the domain of their own email. Each domain matches exactly: add subdomains separately.")}</p>
                {needsSignIn && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
                        <p className="m-0 min-w-0 flex-1 text-sm text-muted-foreground">{t("To add")}{' '}{suggestion}{t(", sign in again with your email. Adding a domain needs a sign-in from the last 10 minutes that confirms your email address.")}</p>
                        <form action={signInAgainWithEmailAction}>
                            <input type="hidden" name="next" value={KnownPages.AppSettings} />
                            <Button type="submit" variant="outline">
                                <LogInIcon data-icon="inline-start" />{t("Sign in again")}</Button>
                        </form>
                    </div>
                )}
            </div>
        </Section>
    );
}

function DomainRow({ domain, teams }: { domain: WorkspaceDomainView; teams: Team[] }) {
    const { t, language } = useAppI18n();
    const access = domain.teams.length
        ? t("They join {value0}.", { value0: list(domain.teams.map(team => team.name), language) })
        : t("They join without project access until an admin shares projects with them.");
    return (
        <Item variant="outline" role="listitem" className="items-start">
            <ItemMedia variant="icon"><AtSignIcon /></ItemMedia>
            <ItemContent className="min-w-0">
                <ItemTitle className="line-clamp-none break-all">{domain.domain}</ItemTitle>
                <ItemDescription className="line-clamp-none break-words">
                    {access}
                    {domain.addedByName && t(" Added by {value0}.", { value0: domain.addedByName })}
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
    const { t } = useAppI18n();
    const [open, setOpen] = useState(false);
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={mode === 'add'
                ? <Button variant="outline" />
                : <Button variant="ghost" aria-label={t("Change teams for {value0}", { value0: domain })} />}>
                {mode === 'add' ? <><PlusIcon data-icon="inline-start" />{t("Add")}{' '}{domain}</> : t("Teams")}
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
    const { t } = useAppI18n();
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
                <DialogTitle className="break-all">{mode === 'add' ? t("Add {value0}", { value0: domain }) : t("Teams for {value0}", { value0: domain })}</DialogTitle>
                <DialogDescription>
                    {mode === 'add'
                        ? t("After they sign in, people with an email at {value0} can join this workspace as commenters. Nobody joins without choosing to.", { value0: domain })
                        : t("People who join from now on get these teams. People who already joined keep their access.")}
                </DialogDescription>
            </DialogHeader>
            {teams.length > 0
                ? (
                    <FieldSet>
                        <FieldLegend variant="label">{t("Teams")}</FieldLegend>
                        <FieldDescription>{t("They review every project of these teams, including projects added later.")}</FieldDescription>
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
                : <p className="m-0 text-sm text-muted-foreground">{t("They join without project access until an admin shares projects with them or adds them to a team.")}</p>}
            <FormMessage state={state} />
            <DialogFooter>
                <DialogClose render={<Button type="button" variant="outline" />}>{t("Cancel")}</DialogClose>
                <Button type="submit" disabled={pending}>
                    {pending && <Spinner data-icon="inline-start" />}
                    {mode === 'add' ? t("Add domain") : t("Save")}
                </Button>
            </DialogFooter>
        </form>
    );
}

function RemoveDomain({ domain }: { domain: string }) {
    const { t } = useAppI18n();
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
            <AlertDialogTrigger render={<Button variant="outline" aria-label={t("Remove {value0}", { value0: domain })} />}>{t("Remove")}</AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle className="break-all">{t("Remove")}{' '}{domain}?</AlertDialogTitle>
                    <AlertDialogDescription>{t("People with an email at")}{' '}{domain}{' '}{t("can no longer join on their own. People who already joined stay in the workspace.")}</AlertDialogDescription>
                </AlertDialogHeader>
                <FormMessage state={state} />
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending}>{t("Keep domain")}</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" disabled={pending} onClick={() => remove()}>
                        {pending && <Spinner data-icon="inline-start" />}{t("Remove")}</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
