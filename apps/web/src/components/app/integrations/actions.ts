'use server';

import { z } from 'zod';
import { actionResult, UserFacingError, type ActionState } from '@/src/lib/app/actionResult';
import { appContextOrThrow } from '@/src/lib/app/context';
import { projectIdSchema } from '@/src/lib/app/validation';
import { IntegrationAccessError, requireIntegrationAdmin, setIntegrationTwoWaySync, setIntegrationReplySync } from '@/src/lib/integrations/connection';
import { integrationProviders } from '@/src/lib/integrations/model';
import { revalidateIntegration } from './revalidate';

export async function setTwoWaySyncAction(_: ActionState, form: FormData): Promise<ActionState> {
    return actionResult(async () => {
        const projectId = projectIdSchema.parse(form.get('projectId'));
        const provider = z.enum(integrationProviders).parse(form.get('provider'));
        const enabled = z.enum(['true', 'false']).parse(form.get('enabled')) === 'true';
        const context = await appContextOrThrow({ admin: true });
        try {
            const project = await requireIntegrationAdmin(context, projectId);
            await setIntegrationTwoWaySync(project, provider, context.user.id, enabled);
        } catch (error) {
            if (error instanceof IntegrationAccessError) throw new UserFacingError(error.message);
            throw error;
        }
        revalidateIntegration(projectId, provider);
    }, 'Two-way status sync is saved.');
}

export async function setReplySyncAction(_: ActionState, form: FormData): Promise<ActionState> {
    return actionResult(async () => {
        const projectId = projectIdSchema.parse(form.get('projectId'));
        const provider = z.enum(integrationProviders).parse(form.get('provider'));
        const enabled = z.enum(['true', 'false']).parse(form.get('enabled')) === 'true';
        const context = await appContextOrThrow({ admin: true });
        try {
            const project = await requireIntegrationAdmin(context, projectId);
            await setIntegrationReplySync(project, provider, context.user.id, enabled);
        } catch (error) {
            if (error instanceof IntegrationAccessError) throw new UserFacingError(error.message);
            throw error;
        }
        revalidateIntegration(projectId, provider);
    }, 'Reply sync is saved.');
}
