'use client';

import { useActionState, useState } from 'react';
import { Input } from '@signalco/ui-primitives/Input';
import { Button } from '@signalco/ui-primitives/Button';
import { Checkbox } from '@signalco/ui-primitives/Checkbox';
import { Link } from '@signalco/ui-primitives/Link';
import { SelectItems } from '@signalco/ui-primitives/SelectItems';
import { FormMessage } from '../FormMessage';
import { KnownPages } from '../../../knownPages';
import { inviteAction } from './actions';

type Role = 'commenter' | 'admin';
type Access = 'selected' | 'all';

const roleDescriptions: Record<Role, string> = {
    commenter: 'Reviews and comments on the projects you choose. Can\'t change settings or invite people.',
    admin: 'Every project, its settings and the people in the workspace. Can make comments private.'
};

/** Invite someone: their email, the role and, for commenters, the projects they can review */
export function InviteForm({ projects, fromProjectId }: {
    projects: { id: string; name: string }[];
    /** The project the invitation started from (it opens after accepting) */
    fromProjectId?: string;
}) {
    const [state, formAction, pending] = useActionState(inviteAction, null);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<Role>('commenter');
    const [access, setAccess] = useState<Access>('selected');
    const [selected, setSelected] = useState<string[]>(() => fromProjectId ? [fromProjectId] : []);

    if (state?.ok) {
        return (
            <div role="status" className="flex flex-col gap-3">
                <h2 className="m-0 text-xl font-semibold tracking-[-0.015em]">Invitation sent</h2>
                <p className="m-0 text-sm text-muted-foreground">
                    We emailed an invitation to <span className="font-medium text-foreground">{state.data.email}</span>.
                    The link works once and expires in 7 days.
                </p>
                {state.data.devLink && (
                    <p className="m-0 text-sm">
                        <Link href={state.data.devLink}>Open the invitation link</Link>
                        <span className="text-muted-foreground"> (no email is sent on this deployment)</span>
                    </p>
                )}
                <div className="flex gap-2">
                    <Button href={KnownPages.AppUsers} variant="solid">Done</Button>
                    <Button href={`${KnownPages.AppInviteUser}${fromProjectId ? `?project=${fromProjectId}` : ''}`} variant="plain">Invite someone else</Button>
                </div>
            </div>
        );
    }

    const toggleProject = (id: string, checked: boolean) =>
        setSelected(current => checked ? [...new Set([...current, id])] : current.filter(other => other !== id));

    return (
        <form action={formAction} className="flex flex-col gap-6">
            {fromProjectId && <input type="hidden" name="from" value={fromProjectId} />}
            <input type="hidden" name="role" value={role} />
            <input type="hidden" name="access" value={access} />
            {access === 'selected' && selected.map(id => <input key={id} type="hidden" name="project" value={id} />)}
            <Input
                label="Email"
                name="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="off"
                placeholder="name@example.com"
                fullWidth />
            <div className="flex flex-col gap-2">
                <SelectItems
                    label="Role"
                    value={role}
                    onValueChange={(value) => setRole(value === 'admin' ? 'admin' : 'commenter')}
                    items={[
                        { value: 'commenter', label: 'Commenter' },
                        { value: 'admin', label: 'Admin' }
                    ]} />
                <p className="m-0 text-sm text-muted-foreground">{roleDescriptions[role]}</p>
            </div>
            {role === 'commenter' && (
                <div className="flex flex-col gap-3">
                    <SelectItems
                        label="Projects"
                        value={access}
                        onValueChange={(value) => setAccess(value === 'all' ? 'all' : 'selected')}
                        items={[
                            { value: 'selected', label: 'Selected projects' },
                            { value: 'all', label: 'All projects, now and later' }
                        ]} />
                    {access === 'selected' && (
                        projects.length ? (
                            <fieldset className="m-0 flex flex-col gap-2 rounded-xl border p-4">
                                <legend className="px-1 text-sm font-medium">Projects they can review</legend>
                                {projects.map(project => (
                                    <Checkbox
                                        key={project.id}
                                        label={project.name}
                                        checked={selected.includes(project.id)}
                                        onCheckedChange={(checked: boolean | 'indeterminate') => toggleProject(project.id, checked === true)} />
                                ))}
                            </fieldset>
                        ) : (
                            <p className="m-0 text-sm text-muted-foreground">There are no projects yet. Choose all projects, or create one first.</p>
                        )
                    )}
                </div>
            )}
            <FormMessage state={state} />
            <Button type="submit" variant="solid" size="lg" className="self-start" loading={pending}>Send invitation</Button>
        </form>
    );
}
