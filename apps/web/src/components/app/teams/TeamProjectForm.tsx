'use client';
import { useAppI18n } from '@/src/lib/i18n/client';


import { useState } from 'react';
import type { DbTeam } from '@/src/lib/app/model';
import { teamProjectsAction } from './actions';
import { type AccessData, currentUpdate } from './accessFormData';
import { CheckList } from './AccessFormFields';
import { ConfirmAccess } from './ConfirmAccess';
import { Impact } from './AccessImpact';

export function TeamProjectForm({ team, data }: { team: DbTeam; data: AccessData }) {
    const { t } = useAppI18n();
    const [selected, setSelected] = useState(team.projectIds);
    const affected = data.people.filter((person) => person.member.teamIds?.includes(team.id));
    const nextAccess = {
        ...data.access,
        teams: data.access.teams.map((old) => (old.id === team.id ? { ...old, projectIds: selected } : old))
    };
    return (
        <div className="flex flex-col gap-4">
            <CheckList
                label={t("Selected projects")}
                value={selected}
                onChange={setSelected}
                options={data.projects.map((project) => ({
                    id: project.id,
                    name: `${project.name} · ${project.access === 'guests' ? 'Anyone with the link' : project.access === 'disabled' ? 'Comments off' : 'Invited people'}`
                }))}
                description={t("Only selected projects are shared. Future projects are never added automatically.")}
            />
            <ConfirmAccess
                label={t("Review project changes")}
                title={t("Change this team's projects?")}
                description={t("{value0} accepted people are in this team. External reviewers who gain access are listed below. Direct grants and other teams remain independent.", { value0: affected.length })}
                action={() => teamProjectsAction(team.id, selected, data.revision)}
            >
                <p className="text-sm">{t("External reviewers:")}{' '}
                    {affected
                        .filter((person) => person.member.relationship === 'external')
                        .map((person) => person.name)
                        .join(', ') || t("None")}
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
