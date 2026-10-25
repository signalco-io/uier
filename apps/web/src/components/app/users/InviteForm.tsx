'use client';

import { useActionState, useId, useState } from 'react';
import Link from 'next/link';
import { MailCheckIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/src/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/src/components/ui/radio-group';
import { Spinner } from '@/src/components/ui/spinner';
import { ChoiceCard } from '../ChoiceCard';
import { FormMessage } from '../FormMessage';
import { inviteAction } from './actions';

type Role = 'commenter' | 'admin';
type Access = 'selected' | 'all';

const roles: { value: Role; label: string; description: string }[] = [
    { value: 'commenter', label: 'Commenter', description: 'Reviews and comments on the projects you choose. Can\'t change settings or invite people.' },
    { value: 'admin', label: 'Admin', description: 'Every project, its settings and the people in the workspace. Can make comments private.' }
];

/** The invite dialog's content: their email, the role and, for commenters, the projects they can review */
export function InviteForm({ projects, fromProjectId, onDone, onInviteAnother }: {
    projects: { id: string; name: string }[];
    /** The project the invitation started from (ticked, and it opens after accepting) */
    fromProjectId?: string;
    onDone: () => void;
    onInviteAnother: () => void;
}) {
    const id = useId();
    const [state, formAction, pending] = useActionState(inviteAction, null);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<Role>('commenter');
    const [access, setAccess] = useState<Access>('selected');
    const [selected, setSelected] = useState<string[]>(() => fromProjectId ? [fromProjectId] : []);
    const fromProject = projects.find(project => project.id === fromProjectId);

    if (state?.ok) {
        return (
            <>
                <div role="status">
                    <DialogHeader className="items-center text-center">
                        <span aria-hidden="true" className="mb-2 flex size-10 items-center justify-center rounded-lg bg-muted text-foreground">
                            <MailCheckIcon className="size-5" />
                        </span>
                        <DialogTitle>Invitation sent</DialogTitle>
                        <DialogDescription>
                            We emailed an invitation to <span className="font-medium text-foreground">{state.data.email}</span>.
                            The link works once and expires in 7 days.
                        </DialogDescription>
                        {state.data.devLink && (
                            <p className="m-0 text-sm text-muted-foreground">
                                <Link href={state.data.devLink}>Open the invitation link</Link> (no email is sent on this deployment)
                            </p>
                        )}
                    </DialogHeader>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onInviteAnother}>Invite someone else</Button>
                    <Button onClick={onDone}>Done</Button>
                </DialogFooter>
            </>
        );
    }

    const toggleProject = (projectId: string, checked: boolean) =>
        setSelected(current => checked ? [...new Set([...current, projectId])] : current.filter(other => other !== projectId));

    return (
        <form action={formAction} className="flex flex-col gap-6">
            {fromProjectId && <input type="hidden" name="from" value={fromProjectId} />}
            <input type="hidden" name="role" value={role} />
            <input type="hidden" name="access" value={access} />
            {access === 'selected' && selected.map(projectId => <input key={projectId} type="hidden" name="project" value={projectId} />)}
            <DialogHeader>
                <DialogTitle>Invite someone</DialogTitle>
                <DialogDescription>
                    {fromProject
                        ? `They get an email with a link that signs them in and opens ${fromProject.name} for review.`
                        : 'They get an email with a link that signs them in.'}
                </DialogDescription>
            </DialogHeader>
            <FieldGroup>
                <Field>
                    <FieldLabel htmlFor={`${id}-email`}>Email</FieldLabel>
                    <Input
                        id={`${id}-email`}
                        name="email"
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        required
                        autoComplete="off"
                        placeholder="name@example.com" />
                </Field>
                <FieldSet>
                    <FieldLegend variant="label">Role</FieldLegend>
                    <RadioGroup value={role} onValueChange={(value) => setRole(value === 'admin' ? 'admin' : 'commenter')}>
                        {roles.map(option => (
                            <ChoiceCard
                                key={option.value}
                                id={`${id}-role-${option.value}`}
                                value={option.value}
                                title={option.label}
                                description={option.description} />
                        ))}
                    </RadioGroup>
                </FieldSet>
                {role === 'commenter' && (
                    <FieldSet>
                        <FieldLegend variant="label">Projects</FieldLegend>
                        <RadioGroup
                            value={access}
                            onValueChange={(value) => setAccess(value === 'all' ? 'all' : 'selected')}
                            className="flex flex-wrap gap-x-6 gap-y-2">
                            <Field orientation="horizontal" className="w-auto">
                                <RadioGroupItem value="selected" id={`${id}-access-selected`} />
                                <FieldLabel htmlFor={`${id}-access-selected`} className="font-normal">Selected projects</FieldLabel>
                            </Field>
                            <Field orientation="horizontal" className="w-auto">
                                <RadioGroupItem value="all" id={`${id}-access-all`} />
                                <FieldLabel htmlFor={`${id}-access-all`} className="font-normal">All projects, now and later</FieldLabel>
                            </Field>
                        </RadioGroup>
                        {access === 'selected' && (
                            projects.length ? (
                                <FieldGroup data-slot="checkbox-group" className="gap-3 rounded-lg border p-4">
                                    <FieldDescription>Projects they can review</FieldDescription>
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
                                <FieldDescription>There are no projects yet. Choose all projects, or create one first.</FieldDescription>
                            )
                        )}
                    </FieldSet>
                )}
            </FieldGroup>
            <FormMessage state={state} />
            <DialogFooter>
                <DialogClose asChild>
                    <Button type="button" variant="outline">Cancel</Button>
                </DialogClose>
                <Button type="submit" disabled={pending}>
                    {pending && <Spinner data-icon="inline-start" />}
                    Send invitation
                </Button>
            </DialogFooter>
        </form>
    );
}
