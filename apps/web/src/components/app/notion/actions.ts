'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { KnownPageLinks } from '@/src/knownPages';
import { actionResult, UserFacingError, type ActionState } from '@/src/lib/app/actionResult';
import { appContextOrThrow } from '@/src/lib/app/context';
import { IntegrationAccessError, requireIntegrationAdmin, setIntegrationEnabled } from '@/src/lib/integrations/connection';
import { startIntegrationBackfill } from '@/src/lib/integrations/backfill';
import { disconnectNotion, loadNotionDataSources, loadNotionSchema, saveNotionMapping } from '@/src/lib/integrations/notion';
import { NotionApiError } from '@/src/lib/integrations/notion/client';

const sourceId = z.string().regex(/^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Choose an available Notion database.');
async function result<T>(run: () => Promise<T>, message?: string) {
    return actionResult(async () => {
        try { return await run(); }
        catch (error) {
            if (error instanceof IntegrationAccessError) throw new UserFacingError('Only a current workspace admin can manage Notion.');
            if (error instanceof NotionApiError) throw new UserFacingError(error.code === 'mapping_invalid'
                ? 'Choose a title field and a different rich text field for the uier id. Check the optional fields and status choices.'
                : error.status === 401 ? 'Reconnect Notion, then try again.'
                : error.status === 429 || error.status === 529 ? 'Notion is waiting for its request limit to reset. Try again later.'
                : error.status === 409 ? 'The Notion connection changed. Reload settings and try again.'
                : 'Notion could not load or save this choice. Check its access in Notion and try again.');
            throw error;
        }
    }, message);
}
async function admin(form: FormData) {
    const context = await appContextOrThrow({ admin: true });
    const project = await requireIntegrationAdmin(context, z.string().min(1).max(200).parse(form.get('projectId')));
    return { context, project };
}
export async function loadNotionDataSourcesAction(_: ActionState<Awaited<ReturnType<typeof loadNotionDataSources>>>, form: FormData) {
    return result(async () => { const { context, project } = await admin(form); return loadNotionDataSources(project, context.user.id); });
}
export async function loadNotionSchemaAction(_: ActionState<Awaited<ReturnType<typeof loadNotionSchema>> & { dataSourceId: string }>, form: FormData) {
    return result(async () => {
        const { context, project } = await admin(form); const dataSourceId = sourceId.parse(form.get('dataSourceId'));
        return { ...await loadNotionSchema(project, context.user.id, dataSourceId), dataSourceId };
    });
}
export async function saveNotionMappingAction(_: ActionState, form: FormData): Promise<ActionState> {
    return result(async () => {
        const { context, project } = await admin(form); const dataSourceId = sourceId.parse(form.get('dataSourceId'));
        const encoded = z.string().max(5000, 'Load the Notion fields again.').parse(form.get('mapping'));
        let mapping: unknown;
        try { mapping = JSON.parse(encoded); } catch { throw new UserFacingError('Load the Notion fields again.'); }
        await saveNotionMapping(project, context.user.id, { dataSourceId, mapping });
        revalidatePath(KnownPageLinks.projectSettings(project.id));
    }, 'The Notion mapping is saved. Sync is on.');
}
export async function manageNotionAction(_: ActionState<{ message: string }>, form: FormData) {
    return result(async () => {
        const { context, project } = await admin(form);
        const operation = z.enum(['enable', 'disable', 'disconnect', 'backfill']).parse(form.get('operation'));
        let message: string;
        if (operation === 'disconnect') { await disconnectNotion(project, context.user.id); message = 'Notion is disconnected from this project.'; }
        else if (operation === 'backfill') {
            const backfill = await startIntegrationBackfill(project, 'notion', context.user.id);
            message = backfill.total ? `A backfill of ${backfill.total} selected threads is queued. Delivery continues in the background.` : 'There are no eligible threads to backfill.';
        } else { await setIntegrationEnabled(project, 'notion', context.user.id, operation === 'enable'); message = operation === 'enable' ? 'Notion sync is on.' : 'Notion sync is off.'; }
        revalidatePath(KnownPageLinks.projectSettings(project.id));
        return { message };
    });
}
