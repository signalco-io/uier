'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { KnownPageLinks } from '@/src/knownPages';
import { actionResult, UserFacingError, type ActionState } from '@/src/lib/app/actionResult';
import { appContextOrThrow } from '@/src/lib/app/context';
import { IntegrationAccessError, requireIntegrationAdmin } from '@/src/lib/integrations/connection';
import { startIntegrationBackfill } from '@/src/lib/integrations/backfill';
import { disconnectLinear, LinearSetupError, loadLinearLabels, loadLinearProjects, loadLinearStates, loadLinearTeams,
    saveLinearDestination, setLinearEnabled } from '@/src/lib/integrations/linear';
import { LinearApiError } from '@/src/lib/integrations/linear/client';

const id = z.string().uuid('Choose an available Linear destination.');

/** Only bounded messages authored here cross the server action boundary. */
async function linearResult<T>(run: () => Promise<T>, message?: string) {
    return actionResult(async () => {
        try { return await run(); }
        catch (error) {
            if (error instanceof IntegrationAccessError) throw new UserFacingError('Only a current workspace admin can manage Linear.');
            if (error instanceof LinearApiError) throw new UserFacingError(error.code === 'rate_limited'
                ? 'Linear is waiting for its request limit to reset. Try again later.'
                : error.status === 401 ? 'Reconnect Linear, then try again.' : 'Linear could not load or save this choice. Try again.');
            if (error instanceof LinearSetupError) {
                const messages: Record<string, string> = {
                    admin_required: 'Only a current workspace admin can manage Linear.',
                    not_configured: 'Linear is unavailable on this deployment.',
                    connect_first: 'Connect Linear before choosing a destination.',
                    needs_reconnect: 'Reconnect Linear, then try again.',
                    destination_required: 'Save a Linear destination first.',
                    invalid_mapping: 'Choose an open state and a different done state.',
                    mapping_not_available: 'One of these choices is unavailable. Load the team options again.',
                    connection_changed: 'The Linear connection changed. Reload settings and try again.',
                    destination_not_available: 'This team is unavailable to the connected Linear app.'
                };
                throw new UserFacingError(messages[error.code] ?? 'Linear could not complete this change. Reconnect or try again.');
            }
            throw error;
        }
    }, message);
}

async function admin(form: FormData) {
    const context = await appContextOrThrow({ admin: true });
    const projectId = z.string().min(1).max(200).parse(form.get('projectId'));
    const project = await requireIntegrationAdmin(context, projectId);
    return { context, project };
}

export async function loadLinearTeamsAction(_: ActionState<Awaited<ReturnType<typeof loadLinearTeams>>>, form: FormData) {
    return linearResult(async () => {
        const { context, project } = await admin(form);
        return loadLinearTeams(project, context.user.id);
    });
}

type DestinationOptions = { teamId: string; projects: Awaited<ReturnType<typeof loadLinearProjects>>;
    states: Awaited<ReturnType<typeof loadLinearStates>>; labels: Awaited<ReturnType<typeof loadLinearLabels>> };
export async function loadLinearDestinationOptionsAction(_: ActionState<DestinationOptions>, form: FormData) {
    return linearResult(async () => {
        const { context, project } = await admin(form);
        const teamId = id.parse(form.get('teamId'));
        const [projects, states, labels] = await Promise.all([loadLinearProjects(project, context.user.id, teamId),
            loadLinearStates(project, context.user.id, teamId), loadLinearLabels(project, context.user.id, teamId)]);
        return { teamId, projects, states, labels };
    });
}

export async function saveLinearDestinationAction(_: ActionState, form: FormData): Promise<ActionState> {
    return linearResult(async () => {
        const { context, project } = await admin(form);
        const input = z.object({ teamId: id, projectId: id.optional(), openStateId: id, doneStateId: id,
            labelIds: z.array(id).max(20, 'Choose up to 20 labels.'), screenshots: z.boolean() }).parse({
            teamId: form.get('teamId'), projectId: form.get('linearProjectId') || undefined,
            openStateId: form.get('openStateId'), doneStateId: form.get('doneStateId'),
            labelIds: form.getAll('labelId'), screenshots: form.get('screenshots') === 'true'
        });
        await saveLinearDestination(project, context.user.id, input);
        revalidatePath(KnownPageLinks.projectSettings(project.id));
    }, 'The Linear destination is saved. Sync is on.');
}

export async function manageLinearAction(_: ActionState<{ message: string }>, form: FormData) {
    return linearResult(async () => {
        const { context, project } = await admin(form);
        const operation = z.enum(['enable', 'disable', 'disconnect', 'backfill']).parse(form.get('operation'));
        let message: string;
        if (operation === 'disconnect') {
            await disconnectLinear(project, context.user.id);
            message = 'Linear is disconnected from this project.';
        } else if (operation === 'backfill') {
            const result = await startIntegrationBackfill(project, 'linear', context.user.id);
            message = result.total ? `A backfill of ${result.total} selected threads is queued. Delivery continues in the background.`
                : 'There are no eligible threads to backfill.';
        } else {
            await setLinearEnabled(project, context.user.id, operation === 'enable');
            message = operation === 'enable' ? 'Linear sync is on.' : 'Linear sync is off.';
        }
        revalidatePath(KnownPageLinks.projectSettings(project.id));
        return { message };
    });
}
