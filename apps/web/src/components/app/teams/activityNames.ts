import type { DbAccessEvent, DbInvitation, DbProject } from '@/src/lib/app/model';
import { getTeam, listAccessEvents } from '@/src/lib/app/teams';
import { getUser } from '@/src/lib/app/users';
import type { ActivityNames } from './activityText';

/** At most this many earlier invitations are looked up per page, to name who accepted them */
const MAX_INVITATION_LOOKUPS = 10;

/**
 * Names for the ids in a page of access events: people (also those who left), invitations (the address
 * while pending, who accepted it after), teams (also archived ones) and projects. Admin-only, like the
 * events themselves.
 */
export async function activityNames(workspaceId: string, events: DbAccessEvent[], data: {
    people: readonly { member: { userId: string }; name: string }[];
    projects: readonly Pick<DbProject, 'id' | 'name'>[];
    access: { teams: readonly { id: string; name: string }[] };
}, invitations: Pick<DbInvitation, 'id' | 'email'>[]): Promise<ActivityNames> {
    const people = new Map(data.people.map(person => [person.member.userId, person.name]));
    const teams = new Map(data.access.teams.map(team => [team.id, team.name]));
    const projects = new Map(data.projects.map(project => [project.id, project.name]));
    const pending = new Map(invitations.map(invitation => [invitation.id, invitation.email]));

    const memberIds = (event: DbAccessEvent) => event.targetIds.filter(id => id.startsWith('member_')).map(id => id.slice('member_'.length));
    const teamIds = new Set(events.flatMap(event => event.targetIds.filter(id => id.startsWith('team_'))));
    for (const event of events)
        if (event.action === 'team.created' || event.action === 'team.updated')
            if (typeof event.after.name === 'string' && event.targetIds[0] && !teams.has(event.targetIds[0]))
                teams.set(event.targetIds[0], event.after.name);

    // An accepted invitation is gone: who accepted it says who it was for
    const accepted = new Map<string, string>();
    const record = (event: DbAccessEvent) => {
        const [invitationId, memberId] = event.targetIds;
        if (event.action === 'invitation.accepted' && invitationId && memberId)
            accepted.set(invitationId, memberId.slice('member_'.length));
    };
    events.forEach(record);
    const unknown = [...new Set(events
        .filter(event => event.action === 'invitation.created' || event.action === 'invitation.revoked')
        .map(event => event.targetIds[0])
        .filter((id): id is string => Boolean(id) && !pending.has(id!) && !accepted.has(id!)))]
        .slice(0, MAX_INVITATION_LOOKUPS);
    (await Promise.all(unknown.map(id => listAccessEvents(workspaceId, undefined, id)))).forEach(({ events: related }) => related.forEach(record));

    // People who left, and archived teams, are no longer in the workspace's lists
    const userIds = new Set([...events.flatMap(event => [event.actorId, ...memberIds(event)]), ...accepted.values()]);
    await Promise.all([
        ...[...userIds].filter(id => !people.has(id)).map(async id => {
            const user = await getUser(id);
            if (user) people.set(id, user.name || user.email);
        }),
        ...[...teamIds].filter(id => !teams.has(id)).map(async id => {
            const team = (await getTeam(workspaceId, id))?.doc;
            if (team) teams.set(id, team.name);
        })
    ]);

    const invitationNames = new Map(pending);
    for (const [invitationId, userId] of accepted) {
        const name = people.get(userId);
        if (name && !invitationNames.has(invitationId)) invitationNames.set(invitationId, name);
    }
    return { people, invitations: invitationNames, teams, projects };
}
