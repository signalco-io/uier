'use client';
import { useAppI18n } from '@/src/lib/i18n/client';


import { useActionState, useId, useState } from 'react';
import Link from 'next/link';
import { ChevronRightIcon, MailCheckIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/src/components/ui/collapsible';
import { DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/src/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/src/components/ui/radio-group';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from '@/src/components/ui/select';
import { Spinner } from '@/src/components/ui/spinner';
import { ChoiceCard } from '../ChoiceCard';
import { FormMessage } from '../FormMessage';
import { inviteAction } from './actions';

type Role = 'commenter' | 'admin';
type Access = 'selected' | 'all';

const roles: { value: Role; label: string; description: string }[] = [
    { value: 'commenter', label: 'Commenter', description: 'Comments on the projects you choose. Can\'t change settings or invite people.' },
    { value: 'admin', label: 'Admin', description: 'Every project, its settings and people. Can make comments private.' }
];

const relationships = [{ value: 'external', label: 'External' }, { value: 'internal', label: 'Internal' }];

/**
 * The invite dialog's content: their email, the role, for commenters the projects they can review, the
 * teams, and under More options the relationship label. The invitation link is never shown or copied
 * where email is sent: it signs in as the invited address, so only that inbox may have it.
 */
export function InviteForm({ projects, teams = [], fromTeamId, fromProjectId, onDone, onInviteAnother }: {
    projects: { id: string; name: string }[];
    teams?: { id: string; name: string }[];
    fromTeamId?: string;
    /** The project the invitation started from (ticked, and it opens after accepting) */
    fromProjectId?: string;
    onDone: () => void;
    onInviteAnother: () => void;
}) {
    const { t } = useAppI18n();
    const id = useId();
    const [state, formAction, pending] = useActionState(inviteAction, null);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<Role>('commenter');
    const [access, setAccess] = useState<Access>('selected');
    // The project the invitation started from, or the workspace's only project (not from a team: its projects are enough)
    const [selected, setSelected] = useState<string[]>(() => fromProjectId
        ? [fromProjectId]
        : !fromTeamId && projects.length === 1 ? [projects[0]!.id] : []);
    const [relationship, setRelationship] = useState('external');
    const [selectedTeams, setSelectedTeams] = useState<string[]>(fromTeamId ? [fromTeamId] : []);
    const fromProject = projects.find(project => project.id === fromProjectId);

    if (state?.ok) {
        return (
            <>
                <div role="status">
                    <DialogHeader className="items-center text-center">
                        <span aria-hidden="true" className="mb-2 flex size-10 items-center justify-center rounded-lg bg-muted text-foreground">
                            <MailCheckIcon className="size-5" />
                        </span>
                        <DialogTitle>{t("Invitation sent")}</DialogTitle>
                        <DialogDescription>{t("We emailed an invitation to")}{' '}<span className="font-medium text-foreground">{state.data.email}</span>{t(". The link works once and expires in 7 days.")}</DialogDescription>
                        {state.data.devLink && (
                            <p className="m-0 text-sm text-muted-foreground">
                                <Link href={state.data.devLink}>{t("Open the invitation link")}</Link>{' '}{t("(no email is sent on this deployment)")}</p>
                        )}
                    </DialogHeader>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onInviteAnother}>{t("Invite someone else")}</Button>
                    <Button onClick={onDone}>{t("Done")}</Button>
                </DialogFooter>
            </>
        );
    }

    const toggleProject = (projectId: string, checked: boolean) =>
        setSelected(current => checked ? [...new Set([...current, projectId])] : current.filter(other => other !== projectId));

    return (
        <form action={formAction} className="flex flex-col gap-5">
            {fromProjectId && <input type="hidden" name="from" value={fromProjectId} />}
            <input type="hidden" name="role" value={role} />
            <input type="hidden" name="access" value={access} />
            {access === 'selected' && selected.map(projectId => <input key={projectId} type="hidden" name="project" value={projectId} />)}
            <input type="hidden" name="relationship" value={relationship} />
            {selectedTeams.map(teamId => <input key={teamId} type="hidden" name="team" value={teamId} />)}
            <DialogHeader>
                <DialogTitle>{t("Invite someone")}</DialogTitle>
                <DialogDescription>
                    {fromProject
                        ? t("They get an email with a link that signs them in and opens {value0} for review.", { value0: fromProject.name })
                        : t("They get an email with a link that signs them in.")}
                </DialogDescription>
            </DialogHeader>
            <FieldGroup className="gap-5">
                <Field>
                    <FieldLabel htmlFor={`${id}-email`}>{t("Email")}</FieldLabel>
                    <Input
                        id={`${id}-email`}
                        name="email"
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        required
                        autoComplete="off"
                        placeholder={t("name@example.com")} />
                </Field>
                <FieldSet>
                    <FieldLegend variant="label">{t("Role")}</FieldLegend>
                    <RadioGroup value={role} onValueChange={(value) => setRole(value === 'admin' ? 'admin' : 'commenter')} className="grid gap-3 sm:grid-cols-2">
                        {roles.map(option => (
                            <ChoiceCard
                                key={option.value}
                                id={`${id}-role-${option.value}`}
                                value={option.value}
                                title={t(option.label)}
                                description={t(option.description)} />
                        ))}
                    </RadioGroup>
                </FieldSet>
                {role === 'commenter' && (
                    <FieldSet>
                        <FieldLegend variant="label">{t("Projects")}</FieldLegend>
                        <RadioGroup
                            value={access}
                            onValueChange={(value) => setAccess(value === 'all' ? 'all' : 'selected')}
                            className="flex flex-wrap gap-x-6 gap-y-2">
                            <Field orientation="horizontal" className="w-auto">
                                <RadioGroupItem value="selected" id={`${id}-access-selected`} />
                                <FieldLabel htmlFor={`${id}-access-selected`} className="font-normal">{t("Selected projects")}</FieldLabel>
                            </Field>
                            <Field orientation="horizontal" className="w-auto">
                                <RadioGroupItem value="all" id={`${id}-access-all`} />
                                <FieldLabel htmlFor={`${id}-access-all`} className="font-normal">{t("All projects, now and later")}</FieldLabel>
                            </Field>
                        </RadioGroup>
                        {access === 'selected' && (
                            projects.length ? (
                                // A long list scrolls inside its box, so the dialog keeps its buttons in view
                                <FieldGroup data-slot="checkbox-group" role="group" aria-label={t("Projects they can review")} className="max-h-40 gap-3 overflow-y-auto rounded-lg border p-3">
                                    {projects.map(project => (
                                        <Field key={project.id} orientation="horizontal">
                                            <Checkbox
                                                id={`${id}-project-${project.id}`}
                                                checked={selected.includes(project.id)}
                                                onCheckedChange={(checked) => toggleProject(project.id, checked === true)} />
                                            <FieldLabel htmlFor={`${id}-project-${project.id}`} className="font-normal">{project.name}</FieldLabel>
                                        </Field>
                                    ))}
                                </FieldGroup>
                            ) : (
                                <FieldDescription>{t("There are no projects yet. Choose a team, or create a project first.")}</FieldDescription>
                            )
                        )}
                    </FieldSet>
                )}
                {(role === 'admin' || access === 'all') && <p className="m-0 text-sm text-destructive" role="status">{t("This grants every project, including future projects")}{role === 'admin' ? t(", and workspace administration") : ''}{t(". Use selected teams and projects for restricted external access.")}</p>}
                {teams.length > 0 && (
                    <FieldSet>
                        <FieldLegend variant="label">{t("Teams")}</FieldLegend>
                        <FieldDescription>{t("They also review every project of the teams you choose, including projects added later.")}</FieldDescription>
                        <FieldGroup data-slot="checkbox-group" className="max-h-32 gap-3 overflow-y-auto">
                            {teams.map(team => (
                                <Field key={team.id} orientation="horizontal">
                                    <Checkbox
                                        id={`${id}-${team.id}`}
                                        checked={selectedTeams.includes(team.id)}
                                        onCheckedChange={checked => setSelectedTeams(current => checked === true ? [...current, team.id] : current.filter(other => other !== team.id))} />
                                    <FieldLabel htmlFor={`${id}-${team.id}`} className="font-normal">{team.name}</FieldLabel>
                                </Field>
                            ))}
                        </FieldGroup>
                    </FieldSet>
                )}
                {/* A label for the people list only: it changes no permission, so it waits behind More options */}
                <Collapsible className="flex flex-col gap-3">
                    <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="group/more h-auto self-start px-0 py-1 text-muted-foreground hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent aria-expanded:text-foreground dark:hover:bg-transparent" />}>
                        <ChevronRightIcon data-icon="inline-start" className="transition-transform group-data-panel-open/more:rotate-90" />{t("More options")}</CollapsibleTrigger>
                    <CollapsibleContent>
                        <Field>
                            <FieldLabel htmlFor={`${id}-relationship`}>{t("Relationship")}</FieldLabel>
                            <Select items={relationships} value={relationship} onValueChange={value => value !== null && setRelationship(value)}>
                                <SelectTrigger id={`${id}-relationship`} className="w-40"><SelectValue /></SelectTrigger>
                                <SelectContent><SelectGroup>{relationships.map(item => <SelectItem key={item.value} value={item.value}>{t(item.label)}</SelectItem>)}</SelectGroup></SelectContent>
                            </Select>
                            <FieldDescription>{t("A label on the users list. It changes no permissions.")}</FieldDescription>
                        </Field>
                    </CollapsibleContent>
                </Collapsible>
            </FieldGroup>
            <FormMessage state={state} />
            <DialogFooter>
                <DialogClose render={<Button type="button" variant="outline" />}>{t("Cancel")}</DialogClose>
                <Button type="submit" disabled={pending}>
                    {pending && <Spinner data-icon="inline-start" />}{t("Send invitation")}</Button>
            </DialogFooter>
        </form>
    );
}
