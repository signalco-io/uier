import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { AppContext } from './context';
import { UserFacingError } from './actionErrors';
import { hasProjectAccess, loadWorkspaceAccess, projectAccessSources, type AccessSnapshot } from './access';
import { mutateAccess } from './accessMutations';
import {
    MAX_ACTIVE_TEAMS,
    MAX_TEAM_NAME_LENGTH,
    MAX_TEAM_DESCRIPTION_LENGTH,
    MAX_TEAM_PROJECTS,
    MAX_TEAMS_PER_MEMBER,
    MAX_BULK_PEOPLE
} from './limits';
import {
    memberId,
    workspacePk,
    type DbTeam,
    type DbTeamName,
    type DbProject,
    type DbMember,
    type DbAccessEvent,
    type MemberRelationship,
    type ProjectsAccess
} from './model';
import { getAppStore, type AppStore, type AppMutation } from './store';
import { sha256Hex } from './tokens';

export const teamNameSchema = z
    .string()
    .transform((value) => value.normalize('NFKC').replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(1, 'Enter a team name.').max(MAX_TEAM_NAME_LENGTH));
export const teamDescriptionSchema = z
    .string()
    .trim()
    .max(MAX_TEAM_DESCRIPTION_LENGTH)
    .transform((value) => value || undefined);
export const teamIdsSchema = z
    .array(z.string().regex(/^team_[A-Za-z0-9_-]{21}$/))
    .max(MAX_TEAMS_PER_MEMBER)
    .transform((ids) => [...new Set(ids)]);
export const relationshipSchema = z.enum(['internal', 'external']).optional();
const projectIdsSchema = z.array(z.string().regex(/^[a-z0-9]{12}$/)).transform((ids) => [...new Set(ids)]);
const nameId = (key: string) => `team_name_${sha256Hex(key)}`;

export async function getTeam(workspaceId: string, id: string, store = getAppStore()) {
    if (!/^team_[A-Za-z0-9_-]{21}$/.test(id)) return null;
    const team = await store.get<DbTeam>(workspacePk(workspaceId), id);
    return team?.doc.type === 'team' && team.doc.workspaceId === workspaceId && team.doc.state !== 'deleted'
        ? team
        : null;
}

export async function validateTeamIds(workspaceId: string, ids: string[], store = getAppStore()) {
    const selected = teamIdsSchema.parse(ids);
    const teams = await Promise.all(selected.map((id) => getTeam(workspaceId, id, store)));
    if (teams.some((team) => !team || team.doc.state !== 'active'))
        throw new UserFacingError('A selected team is unavailable. Refresh and choose again.');
    return selected;
}
export async function validateProjectIds(workspaceId: string, ids: string[], store = getAppStore()) {
    const selected = projectIdsSchema.parse(ids);
    const projects = await Promise.all(selected.map((id) => store.get<DbProject>(workspacePk(workspaceId), id)));
    if (projects.some((project) => project?.doc.type !== 'project' || project.doc.workspaceId !== workspaceId))
        throw new UserFacingError('A selected project is unavailable.');
    return selected;
}

/** Server-side directory pagination; names remain reserved on archive. */
export async function listTeams(
    workspaceId: string,
    { state = 'active', search = '', after }: { state?: 'active' | 'archived'; search?: string; after?: string } = {}
) {
    const rows = await getAppStore().query<DbTeam>({
        type: 'team',
        pk: workspacePk(workspaceId),
        where: { state },
        nameContains: search.trim().toLowerCase(),
        orderBy: 'id',
        afterId: after,
        limit: 21
    });
    return { teams: rows.slice(0, 20), next: rows.length > 20 ? rows[19]!.id : undefined };
}
export async function listAccessEvents(workspaceId: string, after?: string, targetId?: string) {
    const events = await getAppStore().query<DbAccessEvent>({
        type: 'access-event',
        pk: workspacePk(workspaceId),
        orderBy: 'id',
        afterId: after,
        targetId,
        limit: 21
    });
    return { events: events.slice(0, 20), next: events.length > 20 ? events[19]!.id : undefined };
}

export async function saveTeam(
    context: AppContext,
    input: { id?: string; name: string; description?: string; projectIds?: string[] },
    expectedRevision?: number
) {
    const name = teamNameSchema.parse(input.name),
        description = teamDescriptionSchema.parse(input.description ?? '');
    const nameKey = name.toLowerCase(),
        id = input.id ?? `team_${nanoid()}`,
        pk = workspacePk(context.workspace.id);
    await mutateAccess(
        context.workspace.id,
        context.user.id,
        async (store) => {
            const old = input.id ? await getTeam(context.workspace.id, id, store) : null;
            if (input.id && !old) throw new UserFacingError('This team is unavailable.');
            if (old && old.doc.name === name && old.doc.description === description) return null;
            if (!old && (await loadWorkspaceAccess(context.workspace.id, store)).teams.length >= MAX_ACTIVE_TEAMS)
                throw new UserFacingError(`A workspace can have up to ${MAX_ACTIVE_TEAMS} active teams.`);
            const reservation = await store.get<DbTeamName>(pk, nameId(nameKey));
            if (reservation && reservation.doc.teamId !== id)
                throw new UserFacingError('A team already uses this name.');
            const now = new Date().toISOString();
            const doc: DbTeam = {
                ...(old?.doc ?? {
                    type: 'team',
                    id,
                    pk,
                    workspaceId: context.workspace.id,
                    state: 'active',
                    projectIds: await validateProjectIds(
                        context.workspace.id,
                        z
                            .array(z.string())
                            .max(MAX_TEAM_PROJECTS)
                            .parse(input.projectIds ?? []),
                        store
                    ),
                    createdBy: context.user.id,
                    createdAt: now
                }),
                name,
                nameKey,
                description,
                updatedBy: context.user.id,
                updatedAt: now
            };
            const operations: AppMutation[] = [
                old ? { kind: 'replace', doc, etag: old.etag } : { kind: 'create', doc }
            ];
            if (!reservation)
                operations.push({
                    kind: 'create',
                    doc: {
                        type: 'team-name',
                        id: nameId(nameKey),
                        pk,
                        workspaceId: context.workspace.id,
                        teamId: id
                    } as DbTeamName
                });
            if (old && old.doc.nameKey !== nameKey) {
                const previous = await store.get<DbTeamName>(pk, nameId(old.doc.nameKey));
                if (previous) operations.push({ kind: 'delete', pk, id: previous.doc.id, etag: previous.etag });
            }
            return {
                operations,
                action: old ? 'team.updated' : 'team.created',
                targetIds: [id],
                before: old ? { name: old.doc.name, description: old.doc.description ?? '' } : {},
                after: { name, description: description ?? '', projectIds: doc.projectIds }
            };
        },
        { expectedRevision }
    );
    return id;
}

export async function setTeamProjects(context: AppContext, teamId: string, ids: string[], expectedRevision?: number) {
    return await mutateAccess(
        context.workspace.id,
        context.user.id,
        async (store) => {
            const team = await getTeam(context.workspace.id, teamId, store);
            if (!team || team.doc.state !== 'active') throw new UserFacingError('This team is unavailable.');
            const projectIds = await validateProjectIds(
                context.workspace.id,
                z.array(z.string()).max(MAX_TEAM_PROJECTS).parse(ids),
                store
            );
            if (JSON.stringify([...team.doc.projectIds].sort()) === JSON.stringify([...projectIds].sort())) return null;
            return {
                operations: [
                    {
                        kind: 'replace',
                        doc: {
                            ...team.doc,
                            projectIds,
                            updatedBy: context.user.id,
                            updatedAt: new Date().toISOString()
                        },
                        etag: team.etag
                    }
                ],
                action: 'team.projects',
                targetIds: [teamId],
                before: { projectIds: team.doc.projectIds },
                after: { projectIds }
            };
        },
        { expectedRevision }
    );
}

export async function changeTeamState(
    context: AppContext,
    teamId: string,
    state: 'active' | 'archived' | 'deleted',
    expectedRevision?: number
) {
    return await mutateAccess(
        context.workspace.id,
        context.user.id,
        async (store) => {
            const team = await getTeam(context.workspace.id, teamId, store);
            if (!team) throw new UserFacingError('This team is unavailable.');
            if (team.doc.state === state) return null;
            if (
                state === 'active' &&
                (await loadWorkspaceAccess(context.workspace.id, store)).teams.length >= MAX_ACTIVE_TEAMS
            )
                throw new UserFacingError('The workspace has reached its active team limit.');
            const now = new Date().toISOString();
            const operations: AppMutation[] = [
                {
                    kind: 'replace',
                    doc: {
                        ...team.doc,
                        state,
                        invitationGeneration: (team.doc.invitationGeneration ?? 0) + 1,
                        projectIds: [],
                        updatedBy: context.user.id,
                        updatedAt: now,
                        archivedAt: state === 'archived' ? now : undefined
                    },
                    etag: team.etag
                }
            ];
            if (state === 'deleted') {
                const reservation = await store.get<DbTeamName>(team.doc.pk, nameId(team.doc.nameKey));
                if (reservation)
                    operations.push({
                        kind: 'delete',
                        pk: team.doc.pk,
                        id: reservation.doc.id,
                        etag: reservation.etag
                    });
            }
            return {
                operations,
                action: `team.${state === 'active' ? 'restored' : state}`,
                targetIds: [teamId],
                before: { state: team.doc.state, projectIds: team.doc.projectIds },
                after: { state, projectIds: [] }
            };
        },
        { expectedRevision }
    );
}

export type MemberAccessUpdate = { teamIds: string[]; projects: ProjectsAccess; relationship?: MemberRelationship };
export async function updateMemberAccess(
    context: AppContext,
    userId: string,
    update: MemberAccessUpdate,
    expectedRevision?: number
) {
    return await mutateAccess(
        context.workspace.id,
        context.user.id,
        async (store) => {
            const old = await store.get<DbMember>(workspacePk(context.workspace.id), memberId(userId));
            if (!old || old.doc.type !== 'member' || old.doc.workspaceId !== context.workspace.id)
                throw new UserFacingError('This person is no longer in the workspace.');
            const teamIds = teamIdsSchema.parse(update.teamIds);
            await validateTeamIds(
                context.workspace.id,
                teamIds.filter((id) => !old.doc.teamIds?.includes(id)),
                store
            );
            const projects =
                update.projects === 'all'
                    ? 'all'
                    : await validateProjectIds(context.workspace.id, update.projects, store);
            const relationship = relationshipSchema.parse(update.relationship);
            const before = {
                teamIds: old.doc.teamIds ?? [],
                projects: old.doc.projects,
                relationship: old.doc.relationship ?? null
            };
            const after = { teamIds, projects, relationship: relationship ?? null };
            if (JSON.stringify(before) === JSON.stringify(after)) return null;
            return {
                operations: [{ kind: 'replace', doc: { ...old.doc, teamIds, projects, relationship }, etag: old.etag }],
                action: 'member.access',
                targetIds: [...new Set([old.doc.id, ...(old.doc.teamIds ?? []), ...teamIds])],
                before,
                after
            };
        },
        { expectedRevision }
    );
}

export async function bulkTeamMembership(
    context: AppContext,
    userIds: string[],
    teamIds: string[],
    mode: 'add' | 'remove',
    expectedRevision: number
) {
    const people = z
        .array(z.string())
        .min(1)
        .max(MAX_BULK_PEOPLE)
        .parse([...new Set(userIds)]);
    const teams = teamIdsSchema.parse(teamIds);
    const results: { userId: string; ok: boolean; error?: string }[] = [];
    let revision = expectedRevision;
    for (const userId of people) {
        try {
            revision = await mutateAccess(
                context.workspace.id,
                context.user.id,
                async (store) => {
                    await validateTeamIds(context.workspace.id, teams, store);
                    const old = await store.get<DbMember>(workspacePk(context.workspace.id), memberId(userId));
                    if (!old || old.doc.type !== 'member' || old.doc.workspaceId !== context.workspace.id)
                        throw new UserFacingError('This person is no longer in the workspace.');
                    const next =
                        mode === 'add'
                            ? [...new Set([...(old.doc.teamIds ?? []), ...teams])]
                            : (old.doc.teamIds ?? []).filter((id) => !teams.includes(id));
                    teamIdsSchema.parse(next);
                    if (JSON.stringify(next) === JSON.stringify(old.doc.teamIds ?? [])) return null;
                    return {
                        operations: [{ kind: 'replace', doc: { ...old.doc, teamIds: next }, etag: old.etag }],
                        action: `member.teams.${mode}`,
                        targetIds: [old.doc.id, ...teams],
                        before: { teamIds: old.doc.teamIds ?? [] },
                        after: { teamIds: next }
                    };
                },
                { expectedRevision: revision }
            );
            results.push({ userId, ok: true });
        } catch (error) {
            results.push({
                userId,
                ok: false,
                error:
                    error instanceof UserFacingError
                        ? error.message
                        : error instanceof z.ZodError
                          ? 'The team membership limit was reached.'
                        : 'The result could not be confirmed. Refresh before retrying.'
            });
        }
    }
    return results;
}

export function accessImpact(
    access: AccessSnapshot,
    member: DbMember,
    next: MemberAccessUpdate,
    projects: DbProject[]
) {
    const updated = { ...member, ...next };
    return projects
        .map((project) => ({
            id: project.id,
            name: project.name,
            access: project.access,
            before: projectAccessSources(access, member, project),
            after: projectAccessSources(access, updated, project)
        }))
        .filter((row) => row.before.length || row.after.length);
}

export async function removeAllProjectMemberAccess(
    context: AppContext,
    userId: string,
    projectId: string,
    expectedRevision: number
) {
    return await mutateAccess(
        context.workspace.id,
        context.user.id,
        async (store) => {
            await validateProjectIds(context.workspace.id, [projectId], store);
            const member = await store.get<DbMember>(workspacePk(context.workspace.id), memberId(userId));
            if (!member || member.doc.workspaceId !== context.workspace.id)
                throw new UserFacingError('This person is no longer in the workspace.');
            if (member.doc.role === 'admin') throw new UserFacingError('Workspace admins have every project.');
            if (member.doc.projects === 'all')
                throw new UserFacingError(
                    'Change their all-project grant explicitly before removing access to one project.'
                );
            const access = await loadWorkspaceAccess(context.workspace.id, store);
            const removed = access.teams.filter((team) => team.projectIds.includes(projectId)).map((team) => team.id);
            const next = {
                ...member.doc,
                projects: member.doc.projects.filter((id) => id !== projectId),
                teamIds: (member.doc.teamIds ?? []).filter((id) => !removed.includes(id))
            };
            if (hasProjectAccess(access, next, { id: projectId, workspaceId: context.workspace.id }))
                throw new UserFacingError('Access changed. Refresh and try again.');
            return {
                operations: [{ kind: 'replace', doc: next, etag: member.etag }],
                action: 'member.project.removed',
                targetIds: [member.doc.id, projectId],
                before: { projects: member.doc.projects, teamIds: member.doc.teamIds ?? [] },
                after: { projects: next.projects, teamIds: next.teamIds }
            };
        },
        { expectedRevision }
    );
}
