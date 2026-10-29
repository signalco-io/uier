'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { appContextOrThrow } from '@/src/lib/app/context';
import { actionResult, type ActionState } from '@/src/lib/app/actionResult';
import { parseActionInput } from '@/src/lib/app/validation';
import {
    bulkTeamMembership,
    changeTeamState,
    getTeam,
    removeAllProjectMemberAccess,
    saveTeam,
    setTeamProjects,
    updateMemberAccess,
    validateProjectIds,
    type MemberAccessUpdate
} from '@/src/lib/app/teams';
import { KnownPages } from '@/src/knownPages';
import {
    bulkTeamsActionSchema,
    copyTeamActionSchema,
    memberAccessActionSchema,
    projectTeamActionSchema,
    removeProjectAccessActionSchema,
    teamProjectsActionSchema,
    teamStateActionSchema
} from './actionSchemas';

function refresh() {
    revalidatePath(KnownPages.App, 'layout');
}

export async function saveTeamAction(_: ActionState<string>, form: FormData) {
    return await actionResult(async () => {
        const context = await appContextOrThrow({ admin: true });
        const id = await saveTeam(context, {
            id: z
                .string()
                .optional()
                .parse(form.get('id') || undefined),
            name: z.string().parse(form.get('name')),
            description: z.string().parse(form.get('description') ?? '')
        });
        refresh();
        return id;
    }, 'Team saved.');
}
export async function teamProjectsAction(id: string, projects: string[], revision: number) {
    return await actionResult(async () => {
        const input = parseActionInput(teamProjectsActionSchema, { id, projects, revision });
        await setTeamProjects(await appContextOrThrow({ admin: true }), input.id, input.projects, input.revision);
        refresh();
    });
}
export async function teamStateAction(id: string, state: 'active' | 'archived' | 'deleted', revision: number) {
    return await actionResult(async () => {
        const input = parseActionInput(teamStateActionSchema, { id, state, revision });
        await changeTeamState(await appContextOrThrow({ admin: true }), input.id, input.state, input.revision);
        refresh();
    });
}
export async function memberAccessAction(userId: string, update: MemberAccessUpdate, revision: number) {
    return await actionResult(async () => {
        const input = parseActionInput(memberAccessActionSchema, { userId, update, revision });
        await updateMemberAccess(await appContextOrThrow({ admin: true }), input.userId, input.update, input.revision);
        refresh();
    });
}
export async function bulkTeamsAction(userIds: string[], teamIds: string[], mode: 'add' | 'remove', revision: number) {
    return await actionResult(async () => {
        const input = parseActionInput(bulkTeamsActionSchema, { userIds, teamIds, mode, revision });
        const results = await bulkTeamMembership(
            await appContextOrThrow({ admin: true }),
            input.userIds,
            input.teamIds,
            input.mode,
            input.revision
        );
        refresh();
        return results;
    });
}
export async function removeProjectAccessAction(userId: string, projectId: string, revision: number) {
    return await actionResult(async () => {
        const input = parseActionInput(removeProjectAccessActionSchema, { userId, projectId, revision });
        await removeAllProjectMemberAccess(
            await appContextOrThrow({ admin: true }),
            input.userId,
            input.projectId,
            input.revision
        );
        refresh();
    });
}
export async function projectTeamAction(teamId: string, projectId: string, add: boolean, revision: number) {
    return await actionResult(async () => {
        const input = parseActionInput(projectTeamActionSchema, { teamId, projectId, add, revision });
        const context = await appContextOrThrow({ admin: true });
        const team = await getTeam(context.workspace.id, input.teamId),
            ids = team?.doc.projectIds ?? [];
        await setTeamProjects(
            context,
            input.teamId,
            input.add ? [...new Set([...ids, input.projectId])] : ids.filter((id) => id !== input.projectId),
            input.revision
        );
        refresh();
    });
}

/** Explicit migration helper. Direct grants remain intact; memberships commit per person. */
export async function copyAccessToTeamAction(name: string, projectIds: string[], userIds: string[], revision: number) {
    return await actionResult(async () => {
        const input = parseActionInput(copyTeamActionSchema, { name, projectIds, userIds, revision });
        const context = await appContextOrThrow({ admin: true });
        await validateProjectIds(context.workspace.id, input.projectIds);
        const id = await saveTeam(context, { name: input.name, projectIds: input.projectIds }, input.revision);
        const results = await bulkTeamMembership(context, input.userIds, [id], 'add', input.revision + 1);
        refresh();
        return { id, results };
    });
}
