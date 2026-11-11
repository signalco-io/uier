'use client';
import { useAppI18n } from '@/src/lib/i18n/client';


import type { DbProject, DbTeam } from '@/src/lib/app/model';
import { projectTeamAction, removeProjectAccessAction } from './actions';
import { type AccessData, currentUpdate, type AccessPerson } from './accessFormData';
import { ConfirmAccess } from './ConfirmAccess';
import { Impact } from './AccessImpact';
import { UnavailableButton } from './AccessFormFields';

export function ProjectTeamButton({ team, project, data }: { team: DbTeam; project: DbProject; data: AccessData }) {
    const { t } = useAppI18n();
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
            label={add ? t("Share") : t("Remove")}
            accessibleName={add ? `Share with ${team.name}` : `Remove ${team.name}`}
            size="sm"
            title={`${add ? t("Share") : t("Remove")} ${project.name} ${add ? 'with' : 'from'} ${team.name}?`}
            description={t("Team members follow the current team grant. Other sources can preserve member access. Guest links remain allowed where enabled.")}
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
    const { t } = useAppI18n();
    const accessibleName = t("Remove {value0}'s access", { value0: person.name });
    if (person.member.role === 'admin')
        return (
            <UnavailableButton
                label={t("Remove")}
                accessibleName={accessibleName}
                reason="Workspace admins can review every project."
            />
        );
    if (person.member.projects === 'all')
        return (
            <UnavailableButton
                label={t("Remove")}
                accessibleName={accessibleName}
                reason="They have access to all projects. Change that on their page first."
            />
        );
    const removed = data.access.teams.filter((team) => team.projectIds.includes(project.id)).map((team) => team.id);
    const next = {
        ...currentUpdate(person.member),
        projects: person.member.projects.filter((id) => id !== project.id),
        teamIds: (person.member.teamIds ?? []).filter((id) => !removed.includes(id))
    };
    return (
        <ConfirmAccess
            label={t("Remove")}
            accessibleName={accessibleName}
            size="sm"
            title={t("Remove {value0}'s member access to {value1}?", { value0: person.name, value1: project.name })}
            description={t("This removes this direct grant and every team membership granting this project. Removing those memberships can also remove other projects listed below. Guest links remain allowed where enabled.")}
            action={() => removeProjectAccessAction(person.member.userId, project.id, data.revision)}
        >
            <Impact data={data} person={person} next={next} />
        </ConfirmAccess>
    );
}
