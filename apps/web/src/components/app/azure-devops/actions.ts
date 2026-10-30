'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { KnownPageLinks } from '@/src/knownPages';
import { actionResult, UserFacingError, type ActionState } from '@/src/lib/app/actionResult';
import { appContextOrThrow } from '@/src/lib/app/context';
import { IntegrationAccessError, requireIntegrationAdmin } from '@/src/lib/integrations/connection';
import { startIntegrationBackfill } from '@/src/lib/integrations/backfill';
import { AzureDevOpsSetupError, disconnectAzureDevOps, loadAzureDevOpsOrganizations, loadAzureDevOpsProjectOptions,
    loadAzureDevOpsProjects, saveAzureDevOpsDestination, setAzureDevOpsEnabled } from '@/src/lib/integrations/azure-devops';
import { AzureDevOpsApiError } from '@/src/lib/integrations/azure-devops/client';

const organization = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,48}[A-Za-z0-9])?$/, 'Choose an available organization.');
// Azure DevOps ids are GUIDs, not necessarily RFC version 4 identifiers.
const projectId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Choose an available Azure DevOps project.');
const name = z.string().trim().min(1, 'Choose a work item type and states.').max(128);

/** Only bounded messages authored here cross the server action boundary. */
async function azureDevOpsResult<T>(run: () => Promise<T>, message?: string) {
    return actionResult(async () => {
        try { return await run(); }
        catch (error) {
            if (error instanceof IntegrationAccessError) throw new UserFacingError('Only a current workspace admin can manage Azure DevOps.');
            if (error instanceof AzureDevOpsApiError) throw new UserFacingError(error.code === 'rate_limited'
                ? 'Azure DevOps is waiting for its request limit to reset. Try again later.'
                : error.code === 'unauthenticated' ? 'Reconnect Azure DevOps, then try again.'
                    : error.code === 'forbidden' || error.code === 'not_found' ? 'The connected account cannot reach this choice in Azure DevOps.'
                        : 'Azure DevOps could not load or save this choice. Try again.');
            if (error instanceof AzureDevOpsSetupError) {
                const messages: Record<string, string> = {
                    admin_required: 'Only a current workspace admin can manage Azure DevOps.',
                    not_configured: 'Azure DevOps is unavailable on this deployment.',
                    connect_first: 'Connect Azure DevOps before choosing a destination.',
                    needs_reconnect: 'Reconnect Azure DevOps, then try again.',
                    destination_required: 'Save an Azure DevOps destination first.',
                    invalid_mapping: 'Choose an open state and a different done state.',
                    mapping_not_available: 'One of these choices is unavailable. Load the project options again.',
                    type_unsupported: 'This work item type has no description or repro steps field. Choose another type.',
                    connection_changed: 'The Azure DevOps connection changed. Reload settings and try again.'
                };
                throw new UserFacingError(messages[error.code] ?? 'Azure DevOps could not complete this change. Reconnect or try again.');
            }
            throw error;
        }
    }, message);
}

async function admin(form: FormData) {
    const context = await appContextOrThrow({ admin: true });
    const id = z.string().min(1).max(200).parse(form.get('projectId'));
    const project = await requireIntegrationAdmin(context, id);
    return { context, project };
}

export async function loadAzureDevOpsOrganizationsAction(_: ActionState<Awaited<ReturnType<typeof loadAzureDevOpsOrganizations>>>, form: FormData) {
    return azureDevOpsResult(async () => {
        const { context, project } = await admin(form);
        return loadAzureDevOpsOrganizations(project, context.user.id);
    });
}

type ProjectOptions = { organization: string; projects: Awaited<ReturnType<typeof loadAzureDevOpsProjects>> };
export async function loadAzureDevOpsProjectsAction(_: ActionState<ProjectOptions>, form: FormData) {
    return azureDevOpsResult(async () => {
        const { context, project } = await admin(form);
        const value = organization.parse(form.get('organization'));
        return { organization: value, projects: await loadAzureDevOpsProjects(project, context.user.id, value) };
    });
}

export async function loadAzureDevOpsProjectOptionsAction(_: ActionState<Awaited<ReturnType<typeof loadAzureDevOpsProjectOptions>>>, form: FormData) {
    return azureDevOpsResult(async () => {
        const { context, project } = await admin(form);
        return loadAzureDevOpsProjectOptions(project, context.user.id, organization.parse(form.get('organization')), projectId.parse(form.get('azureProjectId')));
    });
}

export async function saveAzureDevOpsDestinationAction(_: ActionState, form: FormData): Promise<ActionState> {
    return azureDevOpsResult(async () => {
        const { context, project } = await admin(form);
        const input = z.object({ organization, projectId, workItemType: name, openState: name, doneState: name,
            areaPath: z.string().trim().min(1).max(1000).optional() }).parse({
            organization: form.get('organization'), projectId: form.get('azureProjectId'), workItemType: form.get('workItemType'),
            openState: form.get('openState'), doneState: form.get('doneState'), areaPath: form.get('areaPath') || undefined
        });
        await saveAzureDevOpsDestination(project, context.user.id, input);
        revalidatePath(KnownPageLinks.projectSettings(project.id));
    }, 'The Azure DevOps destination is saved. Sync is on.');
}

export async function manageAzureDevOpsAction(_: ActionState<{ message: string }>, form: FormData) {
    return azureDevOpsResult(async () => {
        const { context, project } = await admin(form);
        const operation = z.enum(['enable', 'disable', 'disconnect', 'backfill']).parse(form.get('operation'));
        let message: string;
        if (operation === 'disconnect') {
            await disconnectAzureDevOps(project, context.user.id);
            message = 'Azure DevOps is disconnected from this project.';
        } else if (operation === 'backfill') {
            const result = await startIntegrationBackfill(project, 'azure-devops', context.user.id);
            message = result.total ? `A backfill of ${result.total} selected threads is queued. Delivery continues in the background.`
                : 'There are no eligible threads to backfill.';
        } else {
            await setAzureDevOpsEnabled(project, context.user.id, operation === 'enable');
            message = operation === 'enable' ? 'Azure DevOps sync is on.' : 'Azure DevOps sync is off.';
        }
        revalidatePath(KnownPageLinks.projectSettings(project.id));
        return { message };
    });
}
