'use client';

import { useActionState, useId, useState } from 'react';
import Link from 'next/link';
import { MailCheckIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { CardContent, CardFooter } from '@/src/components/ui/card';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/src/components/ui/empty';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/src/components/ui/radio-group';
import { Spinner } from '@/src/components/ui/spinner';
import { ChoiceCard } from '../ChoiceCard';
import { FormMessage } from '../FormMessage';
import { KnownPages } from '../../../knownPages';
import { inviteAction } from './actions';

type Role = 'commenter' | 'admin';
type Access = 'selected' | 'all';

const roles: { value: Role; label: string; description: string }[] = [
    { value: 'commenter', label: 'Commenter', description: 'Reviews and comments on the projects you choose. Can\'t change settings or invite people.' },
    { value: 'admin', label: 'Admin', description: 'Every project, its settings and the people in the workspace. Can make comments private.' }
];

/** Invite someone: their email, the role and, for commenters, the projects they can review */
export function InviteForm({ projects, fromProjectId }: {
    projects: { id: string; name: string }[];
    /** The project the invitation started from (it opens after accepting) */
    fromProjectId?: string;
}) {
    const id = useId();
    const [state, formAction, pending] = useActionState(inviteAction, null);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<Role>('commenter');
    const [access, setAccess] = useState<Access>('selected');
    const [selected, setSelected] = useState<string[]>(() => fromProjectId ? [fromProjectId] : []);

    if (state?.ok) {
        return (
            <CardContent>
                <Empty role="status" className="p-6">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <MailCheckIcon />
                        </EmptyMedia>
                        <EmptyTitle>
                            <h2 className="m-0 text-lg font-medium">Invitation sent</h2>
                        </EmptyTitle>
                        <EmptyDescription>
                            We emailed an invitation to <span className="font-medium text-foreground">{state.data.email}</span>.
                            The link works once and expires in 7 days.
                        </EmptyDescription>
                        {state.data.devLink && (
                            <EmptyDescription>
                                <Link href={state.data.devLink}>Open the invitation link</Link> (no email is sent on this deployment)
                            </EmptyDescription>
                        )}
                    </EmptyHeader>
                    <EmptyContent className="flex-row justify-center">
                        <Button asChild>
                            <Link href={KnownPages.AppUsers}>Done</Link>
                        </Button>
                        <Button variant="outline" asChild>
                            <Link href={`${KnownPages.AppInviteUser}${fromProjectId ? `?project=${fromProjectId}` : ''}`}>Invite someone else</Link>
                        </Button>
                    </EmptyContent>
                </Empty>
            </CardContent>
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
            <CardContent>
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
            </CardContent>
            <CardFooter className="justify-end gap-3 border-t">
                <FormMessage state={state} className="mr-auto" />
                <Button type="submit" disabled={pending}>
                    {pending && <Spinner data-icon="inline-start" />}
                    Send invitation
                </Button>
            </CardFooter>
        </form>
    );
}
