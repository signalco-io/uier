'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import { useState } from 'react';
import Link from 'next/link';
import { InfoIcon } from 'lucide-react';
import { Field, FieldGroup, FieldDescription, FieldTitle } from '@/src/components/ui/field';
import { Section } from '../PageHeader';
import type { MemberRole, ProjectsAccess } from '@/src/lib/app/model';
import type { MemberAccessUpdate } from '@/src/lib/app/teams';
import { KnownPages } from '@/src/knownPages';
import { memberAccessAction } from './actions';
import { type AccessPerson, type AccessData, currentUpdate } from './accessFormData';
import { ConfirmAccess } from './ConfirmAccess';
import { Impact } from './AccessImpact';
import { Choice, CheckList } from './AccessFormFields';

/** A person's role and access, reviewed together before the guarded save. */
export function MemberAccessForm({ person, data }: { person: AccessPerson; data: AccessData }) {
    const { t } = useAppI18n();
    const [role, setRole] = useState(person.member.role);
    const [teams, setTeams] = useState(person.member.teamIds ?? []);
    const [projects, setProjects] = useState<ProjectsAccess>(person.member.projects);
    const [relationship, setRelationship] = useState(person.member.relationship ?? 'unspecified');
    const next: MemberAccessUpdate = {
        role,
        projects,
        teamIds: teams,
        relationship: relationship === 'internal' || relationship === 'external' ? relationship : undefined
    };
    const changed = JSON.stringify(next) !== JSON.stringify(currentUpdate(person.member));
    const admin = role === 'admin';
    return (
        <Section
            id="edit-access"
            title={t("Role, teams and direct access")}
            description={t("Teams and direct grants add together. Relationship is only a label.")}
            footer={(
                <ConfirmAccess
                    label={t("Review access changes")}
                    title={t("Update this person's access?")}
                    description={t("Review the role and access that remain after this change. Relationship is only a label.")}
                    disabled={!changed}
                    action={() => memberAccessAction(person.member.userId, next, data.revision)}
                >
                    <Impact data={data} person={person} next={next} />
                </ConfirmAccess>
            )}>
            <FieldGroup>
                <Field>
                    <Choice
                        label={t("Role")}
                        value={role}
                        onChange={(value) => setRole(value as MemberRole)}
                        options={[
                            { value: 'admin', label: t("Admin") },
                            { value: 'commenter', label: t("Commenter") }
                        ]}
                    />
                    <FieldDescription>{t("Admins manage the workspace and can review every project. Commenters can review projects they have access to.")}</FieldDescription>
                </Field>
                <Choice
                    label={t("Relationship")}
                    value={relationship}
                    onChange={setRelationship}
                    options={[
                        { value: 'unspecified', label: t("Unspecified") },
                        { value: 'internal', label: t("Internal") },
                        { value: 'external', label: t("External") }
                    ]}
                />
                {data.access.teams.length ? (
                    <CheckList label={t("Teams")} value={teams} onChange={setTeams} options={data.access.teams} />
                ) : (
                    <Field>
                        <FieldTitle>{t("Teams")}</FieldTitle>
                        <FieldDescription>{t("No teams yet.")}{' '}<Link href={KnownPages.AppTeams}>{t("Create a team")}</Link>{' '}{t("to give a group the same projects.")}</FieldDescription>
                    </Field>
                )}
                {teams.some((id) => !data.access.teams.some((team) => team.id === id)) && (
                    <FieldDescription>{t("Archived or deleted team references are retained. They grant no access; restoring a team starts with no project grants.")}</FieldDescription>
                )}
                <Field>
                    <Choice
                        label={t("Direct access")}
                        value={projects === 'all' ? 'all' : 'selected'}
                        onChange={(value) => setProjects(value === 'all' ? 'all' : [])}
                        options={[
                            { value: 'selected', label: t("Selected projects") },
                            { value: 'all', label: t("All projects (including future projects)") }
                        ]}
                    />
                    {/* A note, not an error: what these choices cannot narrow */}
                    {(projects === 'all' || admin) && (
                        <FieldDescription className="flex items-start gap-1.5">
                            <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                            <span>
                                {admin
                                    ? t("Workspace admins always have every project.")
                                    : t("All-project access includes every future project.")}{' '}{t("Team selection does not restrict this access.")}</span>
                        </FieldDescription>
                    )}
                </Field>
                {projects !== 'all' && (
                    <CheckList
                        label={t("Direct projects")}
                        options={data.projects}
                        value={projects}
                        onChange={setProjects}
                    />
                )}
            </FieldGroup>
        </Section>
    );
}
