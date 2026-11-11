import type { DbAccessEvent, ProjectsAccess } from '@/src/lib/app/model';
import type { AppTranslator } from '@/src/lib/i18n/types';

/** Names for the ids in access events, loaded by `activityNames`. */
export type ActivityNames = {
    people: Map<string, string>;
    invitations: Map<string, string>;
    teams: Map<string, string>;
    projects: Map<string, string>;
};

export type ActivityText = { actor: string; text: string; details: string[] };

const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const text = (value: unknown) => typeof value === 'string' ? value : undefined;
const userOf = (memberId: string | undefined) => memberId?.replace(/^member_/, '');
const english: AppTranslator = (message, values) => message.replace(/\{(\w+)\}/g, (match, key: string) => String(values?.[key] ?? match));

/** Localizes event descriptions at presentation time; saved actions, ids and names stay unchanged. */
export function describeAccessEvent(event: DbAccessEvent, names: ActivityNames, t: AppTranslator = english, language = 'en'): ActivityText {
    const list = (items: string[]) => new Intl.ListFormat(language, { style: 'long', type: 'conjunction' }).format(items);
    const person = (memberId: string | undefined) => names.people.get(userOf(memberId) ?? '') ?? t('someone');
    const team = (id: string) => names.teams.get(id) ?? t('a team');
    const project = (id: string) => names.projects.get(id) ?? t('a deleted project');
    const teamNames = (ids: string[]) => ids.map(id => names.teams.has(id) ? t('the {name} team', { name: names.teams.get(id)! }) : t('a team'));
    const projectsText = (projects: unknown) => projects === 'all' ? [t('all projects')] : strings(projects).map(project);
    const changed = (before: string[], after: string[], label: (id: string) => string) => {
        const added = after.filter(id => !before.includes(id)).map(label);
        const removed = before.filter(id => !after.includes(id)).map(label);
        return [added.length ? t('added {items}', { items: list(added) }) : '', removed.length ? t('removed {items}', { items: list(removed) }) : ''].filter(Boolean).join(', ');
    };
    const projectChange = (before: ProjectsAccess | undefined, after: ProjectsAccess | undefined) => {
        if (before === after || JSON.stringify(before) === JSON.stringify(after)) return '';
        if (after === 'all') return t('all projects, now and later');
        if (before === 'all') return after?.length ? t('only {items}', { items: list(after.map(project)) }) : t('no projects');
        return changed(before ?? [], after ?? [], project);
    };
    const { before, after, targetIds: [first, ...rest] } = event;
    const actor = event.actorId === 'system' ? 'uier' : names.people.get(event.actorId) ?? t('Someone');
    const done = (sentence: string, details: string[] = []) => ({ actor, text: sentence, details: details.filter(Boolean) });

    switch (event.action) {
        case 'invitation.created': {
            const who = names.invitations.get(first ?? '') ?? t('someone');
            if (after.role === 'admin') return done(t('invited {person} as an admin', { person: who }));
            const to = [...projectsText(after.projects), ...teamNames(strings(after.teamIds))];
            return done(to.length ? t('invited {person} to {items}', { person: who, items: list(to) }) : t('invited {person}', { person: who }));
        }
        case 'invitation.accepted':
            return done(Object.keys(before).length ? t('accepted an invitation') : after.role === 'admin' ? t('accepted an invitation and joined as an admin') : t('accepted an invitation and joined as a commenter'));
        case 'invitation.revoked': {
            const who = names.invitations.get(first ?? '');
            return done(who ? t('revoked the invitation for {person}', { person: who }) : t('revoked an invitation'));
        }
        case 'member.removed':
            return done(t('removed {person} from the workspace', { person: person(first) }));
        case 'member.joined': {
            const teams = teamNames(strings(after.teamIds));
            return done(t('joined through {domain} as a commenter', { domain: text(after.domain) ?? t('an email domain') }), [teams.length ? t('Teams: {items}', { items: list(teams) }) : '']);
        }
        case 'domain.added': {
            const teams = teamNames(strings(after.teamIds));
            return done(t('added the email domain {domain}', { domain: text(after.domain) ?? '' }).trim(), [teams.length ? t('Teams for people who join: {items}', { items: list(teams) }) : '']);
        }
        case 'domain.updated':
            return done(t('changed the teams for {domain}', { domain: text(after.domain) ?? t('an email domain') }), [changed(strings(before.teamIds), strings(after.teamIds), team)]);
        case 'domain.removed':
            return done(t('removed the email domain {domain}', { domain: text(before.domain) ?? '' }).trim());
        case 'member.access': {
            const projects = projectChange(before.projects as ProjectsAccess, after.projects as ProjectsAccess);
            const teams = changed(strings(before.teamIds), strings(after.teamIds), team);
            const relationship = before.relationship !== after.relationship ? text(after.relationship) : undefined;
            return done(t('changed the access of {person}', { person: person(first) }), [
                projects && t('Projects: {items}', { items: projects }),
                teams && t('Teams: {items}', { items: teams }),
                relationship ? t('Relationship: {value}', { value: relationship === 'internal' ? t('Internal') : t('External') }) : ''
            ]);
        }
        case 'member.teams.add':
            return done(t('added {person} to {items}', { person: person(first), items: list(teamNames(rest)) }));
        case 'member.teams.remove':
            return done(t('removed {person} from {items}', { person: person(first), items: list(teamNames(rest)) }));
        case 'member.project.removed':
            return done(t('removed the access of {person} to {project}', { person: person(first), project: project(rest[0] ?? '') }));
        case 'team.created':
            return done(t('created the team {team}', { team: text(after.name) ?? team(first ?? '') }));
        case 'team.updated': {
            const [old, name] = [text(before.name), text(after.name)];
            return done(old && name && old !== name ? t('renamed the team {before} to {after}', { before: old, after: name }) : t('edited the team {team}', { team: name ?? team(first ?? '') }));
        }
        case 'team.projects':
            return done(t('changed the projects of {team}', { team: team(first ?? '') }), [changed(strings(before.projectIds), strings(after.projectIds), project)]);
        case 'team.archived': return done(t('archived the team {team}', { team: team(first ?? '') }));
        case 'team.restored': return done(t('restored the team {team}', { team: team(first ?? '') }));
        case 'team.deleted': return done(t('deleted the team {team}', { team: team(first ?? '') }));
        case 'project.deleted': return done(t('deleted a project and the access it gave'));
        case 'project.transferred-out': return done(t('transferred {project} to another workspace', { project: text(after.projectName) ?? t('a project') }));
        case 'project.transferred-in': return done(t('transferred {project} to this workspace', { project: text(after.projectName) ?? t('a project') }));
        case 'project.transfer-abandoned': return done(t('ended an unfinished transfer of {project}', { project: text(after.projectName) ?? t('a project') }));
        default: return done(t('changed access'));
    }
}
