'use client';

import { useRouter } from 'next/navigation';
import type { DbTeam } from '@/src/lib/app/model';
import { KnownPages } from '@/src/knownPages';
import { teamStateAction } from './actions';
import { type AccessData, currentUpdate } from './accessFormData';
import { Impact } from './AccessImpact';
import { ConfirmAccess } from './ConfirmAccess';

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
