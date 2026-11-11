'use client';

import { projectAccessSources, type AccessSnapshot } from '@/src/lib/app/accessRules';
import type { MemberAccessUpdate } from '@/src/lib/app/teams';
import { type AccessData, type AccessPerson } from './accessFormData';

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
