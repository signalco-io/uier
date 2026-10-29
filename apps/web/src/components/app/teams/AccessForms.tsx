'use client';

import { useActionState, useId, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Button } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from '@/src/components/ui/dialog';
import { Field, FieldGroup, FieldLabel, FieldSet, FieldLegend, FieldDescription } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Textarea } from '@/src/components/ui/textarea';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { Spinner } from '@/src/components/ui/spinner';
import { FormMessage } from '../FormMessage';
import { hasProjectAccess, projectAccessSources, type AccessSnapshot } from '@/src/lib/app/accessRules';
import type { DbMember, DbProject, DbTeam, ProjectsAccess } from '@/src/lib/app/model';
import type { ActionState } from '@/src/lib/app/actionResult';
import type { MemberAccessUpdate } from '@/src/lib/app/teams';
import { MAX_TEAM_NAME_LENGTH, MAX_TEAM_DESCRIPTION_LENGTH, MAX_BULK_PEOPLE } from '@/src/lib/app/limits';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import {
    bulkTeamsAction,
    copyAccessToTeamAction,
    memberAccessAction,
    projectTeamAction,
    removeProjectAccessAction,
    saveTeamAction,
    teamProjectsAction,
    teamStateAction
} from './actions';

export type AccessPerson = { member: DbMember; name: string };
export type AccessData = { access: AccessSnapshot; projects: DbProject[]; people: AccessPerson[]; revision: number };

export function CheckList({
    label,
    options,
    value,
    onChange,
    description
}: {
    label: string;
    options: readonly { id: string; name: string }[];
    value: string[];
    onChange: (ids: string[]) => void;
    description?: string;
}) {
    const prefix = useId();
    return (
        <FieldSet>
            <FieldLegend variant="label">{label}</FieldLegend>
            {description && <FieldDescription>{description}</FieldDescription>}
            <FieldGroup className="max-h-64 gap-3 overflow-y-auto rounded-lg border p-4">
                {options.length ? (
                    options.map((option) => (
                        <Field key={option.id} orientation="horizontal">
                            <Checkbox
                                id={`${prefix}-${option.id}`}
                                checked={value.includes(option.id)}
                                onCheckedChange={(checked) =>
                                    onChange(
                                        checked === true
                                            ? [...new Set([...value, option.id])]
                                            : value.filter((id) => id !== option.id)
                                    )
                                }
                            />
                            <FieldLabel htmlFor={`${prefix}-${option.id}`} className="min-w-0 break-words font-normal">
                                {option.name}
                            </FieldLabel>
                        </Field>
                    ))
                ) : (
                    <FieldDescription>No choices yet.</FieldDescription>
                )}
            </FieldGroup>
        </FieldSet>
    );
}

export function Choice({
    label,
    value,
    options,
    onChange
}: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
}) {
    const id = useId();
    return (
        <Field>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger id={id}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {options.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
        </Field>
    );
}

export function ConfirmAccess({
    label,
    title,
    description,
    children,
    action,
    onSuccess,
    disabled
}: {
    label: string;
    title: string;
    description: string;
    children?: ReactNode;
    action: () => Promise<ActionState<unknown>>;
    onSuccess?: () => void;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false),
        [pending, startTransition] = useTransition();
    const [result, setResult] = useState<ActionState<unknown>>(null);
    const router = useRouter();
    return (
        <Dialog
            open={open}
            onOpenChange={(value) => {
                if (!pending) {
                    setOpen(value);
                    if (value) setResult(null);
                }
            }}
        >
            <DialogTrigger asChild>
                <Button type="button" variant="outline" disabled={disabled || pending}>
                    {label}
                </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                {children}
                <FormMessage state={result?.ok ? { ok: true, data: undefined, message: 'Access updated.' } : result} />
                <DialogFooter>
                    <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
                        Cancel
                    </Button>
                    <Button
                        disabled={pending}
                        onClick={() =>
                            startTransition(async () => {
                                const outcome = await action();
                                setResult(outcome);
                                if (outcome?.ok) {
                                    toast.success('Changes processed.');
                                    setOpen(false);
                                    router.refresh();
                                    onSuccess?.();
                                }
                            })
                        }
                    >
                        {pending && <Spinner />}Confirm changes
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function TeamEditor({ team }: { team?: DbTeam }) {
    const id = useId();
    const [state, action, pending] = useActionState(saveTeamAction, null);
    const [name, setName] = useState(team?.name ?? ''),
        [description, setDescription] = useState(team?.description ?? '');
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant={team ? 'outline' : 'default'}>{team ? 'Edit team' : 'Create team'}</Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{team ? 'Edit team' : 'Create team'}</DialogTitle>
                    <DialogDescription>
                        Teams share selected projects with a group. New teams start empty.
                    </DialogDescription>
                </DialogHeader>
                <form action={action} className="flex flex-col gap-4">
                    {team && <input type="hidden" name="id" value={team.id} />}
                    <FieldGroup>
                        <Field>
                            <FieldLabel htmlFor={`${id}-name`}>Team name</FieldLabel>
                            <Input
                                id={`${id}-name`}
                                name="name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                required
                                maxLength={MAX_TEAM_NAME_LENGTH}
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor={`${id}-description`}>Description</FieldLabel>
                            <Textarea
                                id={`${id}-description`}
                                name="description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                maxLength={MAX_TEAM_DESCRIPTION_LENGTH}
                            />
                        </Field>
                    </FieldGroup>
                    <FormMessage state={state} />
                    {state?.ok && (
                        <Button asChild>
                            <Link href={KnownPageLinks.team(state.data)}>Open team</Link>
                        </Button>
                    )}
                    <DialogFooter>
                        <Button disabled={pending} type="submit">
                            {pending && <Spinner />}Save team
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

/** Includes all retained sources, so removing one grant cannot look like a complete revocation. */
export function Impact({
    data,
    person,
    next,
    nextAccess = data.access
}: {
    data: AccessData;
    person: AccessPerson;
    next: MemberAccessUpdate;
    nextAccess?: AccessSnapshot;
}) {
    return (
        <div className="flex flex-col gap-2">
            <p className="m-0 text-sm font-medium">{person.name}</p>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {data.projects.flatMap((project) => {
                    const before = projectAccessSources(data.access, person.member, project),
                        after = projectAccessSources(nextAccess, { ...person.member, ...next }, project);
                    if (!before.length && !after.length) return [];
                    const state = !after.length ? 'Loses access' : !before.length ? 'Gains access' : 'Keeps access';
                    return [
                        <li key={project.id} className="rounded-lg border p-3 text-sm">
                            <span className="font-medium">
                                {project.name}: {state}
                            </span>
                            <p className="m-0 text-muted-foreground">
                                {after.join('; ') || 'No member grant remains.'}
                            </p>
                            {before.join() !== after.join() && before.length > 0 && (
                                <p className="m-0 text-muted-foreground">Before: {before.join('; ')}</p>
                            )}
                            {project.access === 'guests' && (
                                <p className="m-0 text-muted-foreground">
                                    Guest links remain allowed. Member access changes do not revoke the public review
                                    link.
                                </p>
                            )}
                        </li>
                    ];
                })}
            </ul>
        </div>
    );
}

const currentUpdate = (member: DbMember): MemberAccessUpdate => ({
    projects: member.projects,
    teamIds: member.teamIds ?? [],
    relationship: member.relationship
});

export function TeamProjectForm({ team, data }: { team: DbTeam; data: AccessData }) {
    const [selected, setSelected] = useState(team.projectIds);
    const affected = data.people.filter((person) => person.member.teamIds?.includes(team.id));
    const nextAccess = {
        ...data.access,
        teams: data.access.teams.map((old) => (old.id === team.id ? { ...old, projectIds: selected } : old))
    };
    return (
        <div className="flex flex-col gap-4">
            <CheckList
                label="Selected projects"
                value={selected}
                onChange={setSelected}
                options={data.projects.map((project) => ({
                    id: project.id,
                    name: `${project.name} · ${project.access === 'guests' ? 'Anyone with the link' : project.access === 'disabled' ? 'Comments off' : 'Invited people'}`
                }))}
                description="Only selected projects are shared. Future projects are never added automatically."
            />
            <ConfirmAccess
                label="Review project changes"
                title="Change this team's projects?"
                description={`${affected.length} accepted people are in this team. External reviewers who gain access are listed below. Direct grants and other teams remain independent.`}
                action={() => teamProjectsAction(team.id, selected, data.revision)}
            >
                <p className="text-sm">
                    External reviewers:{' '}
                    {affected
                        .filter((person) => person.member.relationship === 'external')
                        .map((person) => person.name)
                        .join(', ') || 'None'}
                </p>
                {affected.map((person) => (
                    <Impact
                        key={person.member.id}
                        data={data}
                        person={person}
                        next={currentUpdate(person.member)}
                        nextAccess={nextAccess}
                    />
                ))}
            </ConfirmAccess>
        </div>
    );
}

export function TeamLifecycle({ team, data }: { team: DbTeam; data: AccessData }) {
    const router = useRouter();
    const state = team.state === 'archived' ? 'active' : 'archived';
    const nextAccess = { ...data.access, teams: data.access.teams.filter((old) => old.id !== team.id) };
    const impact = data.people
        .filter((person) => person.member.teamIds?.includes(team.id))
        .map((person) => (
            <Impact
                key={person.member.id}
                data={data}
                person={person}
                next={currentUpdate(person.member)}
                nextAccess={nextAccess}
            />
        ));
    return (
        <div className="flex flex-wrap gap-2">
            <ConfirmAccess
                label={state === 'active' ? 'Restore team' : 'Archive team'}
                title={state === 'active' ? 'Restore this team?' : 'Archive this team?'}
                description="Archiving removes every project grant. Restoring starts with no project grants. People and feedback stay. Guest links remain allowed where enabled."
                action={() => teamStateAction(team.id, state, data.revision)}
            >
                {impact}
            </ConfirmAccess>
            <ConfirmAccess
                label="Delete team"
                title="Permanently delete this team?"
                description="This removes the team and its grant sources. People, projects and feedback stay. This team cannot be restored."
                action={() => teamStateAction(team.id, 'deleted', data.revision)}
                onSuccess={() => router.push(KnownPages.AppTeams)}
            >
                {impact}
            </ConfirmAccess>
        </div>
    );
}

export function BulkTeamForm({ data, fromTeamId }: { data: AccessData; fromTeamId?: string }) {
    const [people, setPeople] = useState<string[]>([]),
        [teams, setTeams] = useState<string[]>(fromTeamId ? [fromTeamId] : []);
    const [mode, setMode] = useState<'add' | 'remove'>('add');
    const [results, setResults] = useState<{ userId: string; ok: boolean; error?: string }[]>([]);
    const selected = data.people.filter((person) => people.includes(person.member.userId));
    return (
        <div className="flex flex-col gap-4">
            <FieldGroup>
                <Choice
                    label="Team change"
                    value={mode}
                    onChange={(value) => setMode(value === 'remove' ? 'remove' : 'add')}
                    options={[
                        { value: 'add', label: 'Add people to teams' },
                        { value: 'remove', label: 'Remove people from teams' }
                    ]}
                />
                <CheckList
                    label="People"
                    description={`Choose up to ${MAX_BULK_PEOPLE} accepted workspace members.`}
                    value={people}
                    onChange={setPeople}
                    options={data.people.map((person) => ({ id: person.member.userId, name: person.name }))}
                />
                <CheckList label="Teams" value={teams} onChange={setTeams} options={data.access.teams} />
            </FieldGroup>
            <ConfirmAccess
                label="Review membership changes"
                title="Change team membership?"
                description="Each person is saved separately. Review lost and retained access across every affected project. Direct grants stay. No invitation is sent."
                disabled={!people.length || !teams.length || people.length > MAX_BULK_PEOPLE}
                action={async () => {
                    const result = await bulkTeamsAction(people, teams, mode, data.revision);
                    if (result?.ok) setResults(result.data);
                    return result;
                }}
            >
                {selected.map((person) => (
                    <Impact
                        key={person.member.id}
                        data={data}
                        person={person}
                        next={{
                            ...currentUpdate(person.member),
                            teamIds:
                                mode === 'add'
                                    ? [...new Set([...(person.member.teamIds ?? []), ...teams])]
                                    : (person.member.teamIds ?? []).filter((id) => !teams.includes(id))
                        }}
                    />
                ))}
            </ConfirmAccess>
            {results.length > 0 && (
                <div role="status" className="text-sm">
                    {results.map((result) => (
                        <p key={result.userId}>
                            {data.people.find((person) => person.member.userId === result.userId)?.name ?? 'Person'}:{' '}
                            {result.ok ? 'Saved' : result.error}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
}

export function MemberAccessForm({ person, data }: { person: AccessPerson; data: AccessData }) {
    const [teams, setTeams] = useState(person.member.teamIds ?? []);
    const [projects, setProjects] = useState<ProjectsAccess>(person.member.projects);
    const [relationship, setRelationship] = useState(person.member.relationship ?? 'unspecified');
    const next: MemberAccessUpdate = {
        teamIds: teams,
        projects,
        relationship: relationship === 'internal' || relationship === 'external' ? relationship : undefined
    };
    return (
        <div className="flex flex-col gap-4">
            <FieldGroup>
                <Choice
                    label="Relationship"
                    value={relationship}
                    onChange={setRelationship}
                    options={[
                        { value: 'unspecified', label: 'Unspecified' },
                        { value: 'internal', label: 'Internal' },
                        { value: 'external', label: 'External' }
                    ]}
                />
                <CheckList label="Teams" value={teams} onChange={setTeams} options={data.access.teams} />
                {teams.some((id) => !data.access.teams.some((team) => team.id === id)) && (
                    <p className="m-0 text-sm text-muted-foreground">
                        Archived or deleted team references are retained. They grant no access; restoring a team starts
                        with no project grants.
                    </p>
                )}
                <Choice
                    label="Direct access"
                    value={projects === 'all' ? 'all' : 'selected'}
                    onChange={(value) => setProjects(value === 'all' ? 'all' : [])}
                    options={[
                        { value: 'selected', label: 'Selected projects' },
                        { value: 'all', label: 'All projects (including future projects)' }
                    ]}
                />
                {projects !== 'all' && (
                    <CheckList
                        label="Direct projects"
                        options={data.projects}
                        value={projects}
                        onChange={setProjects}
                    />
                )}
                {(projects === 'all' || person.member.role === 'admin') && (
                    <p className="m-0 text-sm text-destructive">
                        {person.member.role === 'admin'
                            ? 'Workspace admins always have every project.'
                            : 'All-project access includes every future project.'}{' '}
                        Team selection does not restrict this access.
                    </p>
                )}
            </FieldGroup>
            <ConfirmAccess
                label="Review access changes"
                title="Update this person's access?"
                description="Relationship is a label. Teams and direct grants add together. Review access that remains after this change."
                action={() => memberAccessAction(person.member.userId, next, data.revision)}
            >
                <Impact data={data} person={person} next={next} />
            </ConfirmAccess>
        </div>
    );
}

export function CopyAccessToTeam({ data }: { data: AccessData }) {
    const id = useId(),
        [name, setName] = useState(''),
        [people, setPeople] = useState<string[]>([]),
        [projects, setProjects] = useState<string[]>([]);
    const [result, setResult] = useState<{ id: string; results: { userId: string; ok: boolean; error?: string }[] }>();
    return (
        <div className="flex flex-col gap-4">
            <FieldGroup>
                <Field>
                    <FieldLabel htmlFor={id}>New team name</FieldLabel>
                    <Input
                        id={id}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={MAX_TEAM_NAME_LENGTH}
                    />
                </Field>
                <CheckList
                    label="Copy selected people"
                    options={data.people.map((person) => ({ id: person.member.userId, name: person.name }))}
                    value={people}
                    onChange={setPeople}
                />
                <CheckList
                    label="Copy selected projects"
                    options={data.projects}
                    value={projects}
                    onChange={setProjects}
                />
            </FieldGroup>
            <ConfirmAccess
                label="Review new team"
                title="Create a team from these people and projects?"
                description="The new team grants the selected projects to every selected person. Existing direct grants stay. Any removal of direct grants is a separate confirmed change. Memberships save separately."
                disabled={!name.trim() || !people.length || people.length > MAX_BULK_PEOPLE}
                action={async () => {
                    const outcome = await copyAccessToTeamAction(name, projects, people, data.revision);
                    if (outcome?.ok) setResult(outcome.data);
                    return outcome;
                }}
            >
                <p className="text-sm">
                    People:{' '}
                    {data.people
                        .filter((person) => people.includes(person.member.userId))
                        .map(
                            (person) =>
                                `${person.name}${person.member.relationship === 'external' ? ' (external)' : ''}`
                        )
                        .join(', ')}
                </p>
                <p className="text-sm">
                    Team projects:{' '}
                    {data.projects
                        .filter((project) => projects.includes(project.id))
                        .map((project) => project.name)
                        .join(', ') || 'None'}
                </p>
                <p className="text-sm">Each selected person gains these project grants. Other current grants stay.</p>
            </ConfirmAccess>
            {result && (
                <div role="status" className="text-sm">
                    <Link href={KnownPageLinks.team(result.id)}>Open the new team</Link>
                    {result.results.map((item) => (
                        <p key={item.userId}>
                            {data.people.find((person) => person.member.userId === item.userId)?.name}:{' '}
                            {item.ok ? 'Saved' : item.error}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
}

export function ProjectTeamButton({ team, project, data }: { team: DbTeam; project: DbProject; data: AccessData }) {
    const add = !team.projectIds.includes(project.id);
    const nextAccess = {
        ...data.access,
        teams: data.access.teams.map((old) =>
            old.id === team.id
                ? {
                      ...old,
                      projectIds: add
                          ? [...old.projectIds, project.id]
                          : old.projectIds.filter((id) => id !== project.id)
                  }
                : old
        )
    };
    return (
        <ConfirmAccess
            label={add ? 'Share with team' : 'Remove team grant'}
            title={`${add ? 'Share' : 'Remove'} ${project.name} ${add ? 'with' : 'from'} ${team.name}?`}
            description="Team members follow the current team grant. Other sources can preserve member access. Guest links remain allowed where enabled."
            action={() => projectTeamAction(team.id, project.id, add, data.revision)}
        >
            {data.people
                .filter((person) => person.member.teamIds?.includes(team.id))
                .map((person) => (
                    <Impact
                        key={person.member.id}
                        data={{ ...data, projects: [project] }}
                        person={person}
                        next={currentUpdate(person.member)}
                        nextAccess={nextAccess}
                    />
                ))}
        </ConfirmAccess>
    );
}

export function RemoveProjectAccess({
    person,
    project,
    data
}: {
    person: AccessPerson;
    project: DbProject;
    data: AccessData;
}) {
    if (person.member.role === 'admin')
        return (
            <p className="m-0 text-sm text-muted-foreground">Workspace admins cannot be excluded from one project.</p>
        );
    if (person.member.projects === 'all')
        return (
            <p className="m-0 text-sm text-muted-foreground">
                Change the all-project grant in their person detail before removing one project.
            </p>
        );
    const removed = data.access.teams.filter((team) => team.projectIds.includes(project.id)).map((team) => team.id);
    const next = {
        ...currentUpdate(person.member),
        projects: person.member.projects.filter((id) => id !== project.id),
        teamIds: (person.member.teamIds ?? []).filter((id) => !removed.includes(id))
    };
    return (
        <ConfirmAccess
            label="Remove all member access"
            title={`Remove ${person.name}'s member access to ${project.name}?`}
            description="This removes this direct grant and every team membership granting this project. Removing those memberships can also remove other projects listed below. Guest links remain allowed where enabled."
            action={() => removeProjectAccessAction(person.member.userId, project.id, data.revision)}
        >
            <Impact data={data} person={person} next={next} />
        </ConfirmAccess>
    );
}
