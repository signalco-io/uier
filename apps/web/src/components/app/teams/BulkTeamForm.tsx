'use client';

import { useState } from 'react';
import { FieldGroup } from '@/src/components/ui/field';
import { MAX_BULK_PEOPLE } from '@/src/lib/app/limits';
import { bulkTeamsAction } from './actions';
import { type AccessData, currentUpdate } from './accessFormData';
import { Choice, CheckList } from './AccessFormFields';
import { ConfirmAccess } from './ConfirmAccess';
import { Impact } from './AccessImpact';

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
