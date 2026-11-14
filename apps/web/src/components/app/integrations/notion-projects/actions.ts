'use server';

import { revalidatePath } from 'next/cache';
import { actionResult, UserFacingError, type ActionState } from '../../../../lib/app/actionResult';
import { appContextOrThrow } from '../../../../lib/app/context';
import { NotionApiError } from '../../../../lib/integrations/notion/client';
import { getNotionProjectsSettings, loadNotionProjectSchema, loadNotionProjectSources, saveNotionProjectMapping, stopNotionProjects } from '../../../../lib/integrations/notion/projects/settings';
import { makeNotionProjectManual } from '../../../../lib/integrations/notion/projects/sync';
import { manualProjectSchema, mappingActionSchema, sourceIdSchema, stopActionSchema } from './actionSchemas';

async function workspaceAction<T>(run: (workspaceId: string, userId: string) => Promise<T>) {
    const context = await appContextOrThrow({ admin: true });
    try { return await run(context.workspace.id, context.user.id); }
    catch (error) {
        if (error instanceof NotionApiError) throw new UserFacingError('Could not update Notion projects. Check the connection and selected fields.');
        throw error;
    }
}
export async function loadProjectDatabasesAction() {
    return actionResult(() => workspaceAction(loadNotionProjectSources));
}
export async function loadProjectFieldsAction(value: unknown) {
    return actionResult(() => workspaceAction((workspaceId, userId) => loadNotionProjectSchema(workspaceId, userId, sourceIdSchema.parse(value))));
}
export async function saveProjectMappingAction(_: ActionState, form: FormData): Promise<ActionState> {
    return actionResult(() => workspaceAction(async (workspaceId, userId) => {
        const input = mappingActionSchema.parse({ dataSourceId: form.get('dataSourceId'), mapping: JSON.parse(String(form.get('mapping'))) });
        await saveNotionProjectMapping(workspaceId, userId, input.dataSourceId, input.mapping);
        revalidatePath('/app', 'layout');
    }), 'Saved.');
}
export async function stopProjectSyncAction(value: unknown) {
    return actionResult(() => workspaceAction(async (workspaceId, userId) => {
        await stopNotionProjects(workspaceId, userId, stopActionSchema.parse(value) === 'disconnect');
        revalidatePath('/app', 'layout');
        return getNotionProjectsSettings(workspaceId, userId);
    }));
}
export async function manualProjectAction(_: ActionState, form: FormData): Promise<ActionState> {
    return actionResult(() => workspaceAction(async (workspaceId, userId) => {
        await makeNotionProjectManual(workspaceId, manualProjectSchema.parse(form.get('projectId')), userId);
        revalidatePath('/app', 'layout');
    }), 'Saved.');
}
