'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { Field, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { MAX_TEAM_NAME_LENGTH, MAX_BULK_PEOPLE } from '@/src/lib/app/limits';
import { KnownPageLinks } from '@/src/knownPages';
import { copyAccessToTeamAction } from './actions';
import { type AccessData } from './accessFormData';
import { CheckList } from './AccessFormFields';
import { ConfirmAccess } from './ConfirmAccess';

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
