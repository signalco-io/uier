'use client';

import { useState } from 'react';
import Link from 'next/link';
import { InfoIcon } from 'lucide-react';
import { Field, FieldGroup, FieldDescription, FieldTitle } from '@/src/components/ui/field';
import { Section } from '../PageHeader';
import type { ProjectsAccess } from '@/src/lib/app/model';
import type { MemberAccessUpdate } from '@/src/lib/app/teams';
import { KnownPages } from '@/src/knownPages';
import { memberAccessAction } from './actions';
import { type AccessPerson, type AccessData, currentUpdate } from './accessFormData';
import { ConfirmAccess } from './ConfirmAccess';
import { Impact } from './AccessImpact';
import { Choice, CheckList } from './AccessFormFields';

/** A person's relationship, teams and direct access, a settings card whose footer reviews the change before it is saved */
export function MemberAccessForm({ person, data }: { person: AccessPerson; data: AccessData }) {
    const [teams, setTeams] = useState(person.member.teamIds ?? []);
    const [projects, setProjects] = useState<ProjectsAccess>(person.member.projects);
    const [relationship, setRelationship] = useState(person.member.relationship ?? 'unspecified');
    const next: MemberAccessUpdate = {
        teamIds: teams,
        projects,
        relationship: relationship === 'internal' || relationship === 'external' ? relationship : undefined
    };
    const changed = JSON.stringify(next) !== JSON.stringify(currentUpdate(person.member));
    const admin = person.member.role === 'admin';
    return (
        <Section
            id="edit-access"
            title="Teams and direct access"
            description="Teams and direct grants add together. Relationship is only a label."
            footer={(
                <ConfirmAccess
                    label="Review access changes"
                    title="Update this person's access?"
                    description="Relationship is a label. Teams and direct grants add together. Review access that remains after this change."
                    disabled={!changed}
                    action={() => memberAccessAction(person.member.userId, next, data.revision)}
                >
                    <Impact data={data} person={person} next={next} />
                </ConfirmAccess>
            )}>
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
                {data.access.teams.length ? (
                    <CheckList label="Teams" value={teams} onChange={setTeams} options={data.access.teams} />
                ) : (
                    <Field>
                        <FieldTitle>Teams</FieldTitle>
                        <FieldDescription>
                            No teams yet. <Link href={KnownPages.AppTeams}>Create a team</Link> to give a group the same projects.
                        </FieldDescription>
                    </Field>
                )}
                {teams.some((id) => !data.access.teams.some((team) => team.id === id)) && (
                    <FieldDescription>
                        Archived or deleted team references are retained. They grant no access; restoring a team starts
                        with no project grants.
                    </FieldDescription>
                )}
                <Field>
                    <Choice
                        label="Direct access"
                        value={projects === 'all' ? 'all' : 'selected'}
                        onChange={(value) => setProjects(value === 'all' ? 'all' : [])}
                        options={[
                            { value: 'selected', label: 'Selected projects' },
                            { value: 'all', label: 'All projects (including future projects)' }
                        ]}
                    />
                    {/* A note, not an error: what these choices cannot narrow */}
                    {(projects === 'all' || admin) && (
                        <FieldDescription className="flex items-start gap-1.5">
                            <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                            <span>
                                {admin
                                    ? 'Workspace admins always have every project.'
                                    : 'All-project access includes every future project.'}{' '}
                                Team selection does not restrict this access.
                            </span>
                        </FieldDescription>
                    )}
                </Field>
                {projects !== 'all' && (
                    <CheckList
                        label="Direct projects"
                        options={data.projects}
                        value={projects}
                        onChange={setProjects}
                    />
                )}
            </FieldGroup>
        </Section>
    );
}
