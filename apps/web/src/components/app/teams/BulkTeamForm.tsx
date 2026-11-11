'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import { useState } from 'react';
import { FieldGroup } from '@/src/components/ui/field';
import { MAX_BULK_PEOPLE } from '@/src/lib/app/limits';
import { bulkTeamsAction } from './actions';
import { type AccessData, currentUpdate } from './accessFormData';
import { Choice, CheckList } from './AccessFormFields';
import { ConfirmAccess } from './ConfirmAccess';
import { Impact } from './AccessImpact';

export function BulkTeamForm({ data, fromTeamId }: { data: AccessData; fromTeamId?: string }) {
    const { t } = useAppI18n();
    const [people, setPeople] = useState<string[]>([]),
        [teams, setTeams] = useState<string[]>(fromTeamId ? [fromTeamId] : []);
    const [mode, setMode] = useState<'add' | 'remove'>('add');
    const [results, setResults] = useState<{ userId: string; ok: boolean; error?: string }[]>([]);
    const selected = data.people.filter((person) => people.includes(person.member.userId));
    return (
        <div className="flex flex-col gap-4">
            <FieldGroup>
                <Choice
                    label={t("Team change")}
                    value={mode}
                    onChange={(value) => setMode(value === 'remove' ? 'remove' : 'add')}
                    options={[
                        { value: 'add', label: t("Add people to teams") },
                        { value: 'remove', label: t("Remove people from teams") }
                    ]}
                />
                <CheckList
                    label={t("People")}
                    description={t("Choose up to {value0} accepted workspace members.", { value0: MAX_BULK_PEOPLE })}
                    value={people}
                    onChange={setPeople}
                    options={data.people.map((person) => ({ id: person.member.userId, name: person.name }))}
                />
                <CheckList label={t("Teams")} value={teams} onChange={setTeams} options={data.access.teams} />
            </FieldGroup>
            <ConfirmAccess
                label={t("Review membership changes")}
                title={t("Change team membership?")}
                description={t("Each person is saved separately. Review lost and retained access across every affected project. Direct grants stay. No invitation is sent.")}
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
                            {data.people.find((person) => person.member.userId === result.userId)?.name ?? t("Person")}:{' '}
                            {result.ok ? t("Saved") : result.error}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
}
