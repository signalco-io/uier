import type { DbAccessEvent, ProjectsAccess } from '@/src/lib/app/model';

/** Names for the ids in access events, loaded by `activityNames` */
export type ActivityNames = {
    /** A person's name by user id */
    people: Map<string, string>;
    /** An invitation's address while pending, or the name of who accepted it */
    invitations: Map<string, string>;
    teams: Map<string, string>;
    projects: Map<string, string>;
};

/** One access change as a sentence after the actor's name, and what it changed in detail */
export type ActivityText = { actor: string; text: string; details: string[] };

/** "a", "a and b", "a, b and c" */
function list(items: string[]) {
    return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const text = (value: unknown) => typeof value === 'string' ? value : undefined;
const userOf = (memberId: string | undefined) => memberId?.replace(/^member_/, '');

/**
 * Turns access events (`DbAccessEvent`: an action, target ids and the access before and after) into
 * sentences: "invited client@example.com to Acme shop". Ids no longer known read as "someone", "a
 * team" or "a deleted project"; the raw ids never show.
 */
export function describeAccessEvent(event: DbAccessEvent, names: ActivityNames): ActivityText {
    const person = (memberId: string | undefined) => names.people.get(userOf(memberId) ?? '') ?? 'someone';
    const team = (id: string) => names.teams.get(id) ?? 'a team';
    const project = (id: string) => names.projects.get(id) ?? 'a deleted project';
    const teamNames = (ids: string[]) => ids.map(id => names.teams.has(id) ? `the ${names.teams.get(id)} team` : 'a team');
    const projectsText = (projects: unknown) => projects === 'all' ? ['all projects'] : strings(projects).map(project);
    /** What changed between two lists: "added a and b, removed c" */
    const changed = (before: string[], after: string[], label: (id: string) => string) => {
        const added = after.filter(id => !before.includes(id)).map(label);
        const removed = before.filter(id => !after.includes(id)).map(label);
        return [added.length ? `added ${list(added)}` : '', removed.length ? `removed ${list(removed)}` : ''].filter(Boolean).join(', ');
    };
    const projectChange = (before: ProjectsAccess | undefined, after: ProjectsAccess | undefined) => {
        if (before === after || JSON.stringify(before) === JSON.stringify(after))
            return '';
        if (after === 'all')
            return 'all projects, now and later';
        if (before === 'all')
            return after?.length ? `only ${list(after.map(project))}` : 'no projects';
        return changed(before ?? [], after ?? [], project);
    };
    const { before, after, targetIds: [first, ...rest] } = event;
    // A scheduled cleanup whose requester's account is gone acts as uier itself
    const actor = event.actorId === 'system' ? 'uier' : names.people.get(event.actorId) ?? 'Someone';
    const done = (sentence: string, details: string[] = []) => ({ actor, text: sentence, details: details.filter(Boolean) });

    switch (event.action) {
        case 'invitation.created': {
            const who = names.invitations.get(first ?? '') ?? 'someone';
            if (after.role === 'admin')
                return done(`invited ${who} as an admin`);
            const to = [...projectsText(after.projects), ...teamNames(strings(after.teamIds))];
            return done(to.length ? `invited ${who} to ${list(to)}` : `invited ${who}`);
        }
        case 'invitation.accepted':
            return done(Object.keys(before).length
                ? 'accepted an invitation'
                : `accepted an invitation and joined as ${after.role === 'admin' ? 'an admin' : 'a commenter'}`);
        case 'invitation.revoked': {
            const who = names.invitations.get(first ?? '');
            return done(who ? `revoked the invitation for ${who}` : 'revoked an invitation');
        }
        case 'member.removed':
            return done(`removed ${person(first)} from the workspace`);
        case 'member.access': {
            const projects = projectChange(before.projects as ProjectsAccess, after.projects as ProjectsAccess);
            const teams = changed(strings(before.teamIds), strings(after.teamIds), team);
            const relationship = before.relationship !== after.relationship ? text(after.relationship) : undefined;
            return done(`changed the access of ${person(first)}`, [
                projects && `Projects: ${projects}`,
                teams && `Teams: ${teams}`,
                relationship ? `Relationship: ${relationship === 'internal' ? 'Internal' : 'External'}` : ''
            ]);
        }
        case 'member.teams.add':
            return done(`added ${person(first)} to ${list(teamNames(rest))}`);
        case 'member.teams.remove':
            return done(`removed ${person(first)} from ${list(teamNames(rest))}`);
        case 'member.project.removed':
            return done(`removed the access of ${person(first)} to ${project(rest[0] ?? '')}`);
        case 'team.created':
            return done(`created the team ${text(after.name) ?? team(first ?? '')}`);
        case 'team.updated': {
            const [old, name] = [text(before.name), text(after.name)];
            return done(old && name && old !== name ? `renamed the team ${old} to ${name}` : `edited the team ${name ?? team(first ?? '')}`);
        }
        case 'team.projects':
            return done(`changed the projects of ${team(first ?? '')}`, [changed(strings(before.projectIds), strings(after.projectIds), project)]);
        case 'team.archived':
            return done(`archived the team ${team(first ?? '')}`);
        case 'team.restored':
            return done(`restored the team ${team(first ?? '')}`);
        case 'team.deleted':
            return done(`deleted the team ${team(first ?? '')}`);
        case 'project.deleted':
            return done('deleted a project and the access it gave');
        // The project is gone from one of the two workspaces, so its name comes with the event
        case 'project.transferred-out':
            return done(`transferred ${text(after.projectName) ?? 'a project'} to another workspace`);
        case 'project.transferred-in':
            return done(`transferred ${text(after.projectName) ?? 'a project'} to this workspace`);
        case 'project.transfer-abandoned':
            return done(`ended an unfinished transfer of ${text(after.projectName) ?? 'a project'}`);
        default:
            return done('changed access');
    }
}
