'use client';

import { useState } from 'react';
import type { DbTeam } from '@/src/lib/app/model';
import { teamProjectsAction } from './actions';
import { type AccessData, currentUpdate } from './accessFormData';
import { CheckList } from './AccessFormFields';
import { ConfirmAccess } from './ConfirmAccess';
import { Impact } from './AccessImpact';

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
