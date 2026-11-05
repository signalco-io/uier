'use server';

import { revalidatePath } from 'next/cache';
import { actionResult, type ActionState } from '../../../lib/app/actionResult';
import { appContextOrThrow } from '../../../lib/app/context';
import { createClient, updateClient, type ClientSummary } from '../../../lib/app/clients';
import { parseActionInput } from '../../../lib/app/validation';
import { clientActionSchema } from './actionSchemas';

/** Renames a client and saves its description, icon and colour; every project of the client follows */
export async function updateClientAction(_: ActionState<ClientSummary>, formData: FormData): Promise<ActionState<ClientSummary>> {
    return await actionResult(async () => {
        const context = await appContextOrThrow({ admin: true });
        const { clientId } = parseActionInput(clientActionSchema, { clientId: formData.get('clientId') });
        const text = (field: string) => {
            const value = formData.get(field);
            return typeof value === 'string' ? value : '';
        };
        const client = await updateClient(context, clientId, {
            name: text('name'),
            description: text('description'),
            icon: text('icon') || undefined,
            color: text('color') || undefined
        });
        revalidatePath('/app', 'layout');
        return client;
    }, 'The client is saved.');
}

/** A new client for the chosen projects (admins); they move to it from any client they had */
export async function createClientAction(_: ActionState<ClientSummary>, formData: FormData): Promise<ActionState<ClientSummary>> {
    return await actionResult(async () => {
        const context = await appContextOrThrow({ admin: true });
        const text = (field: string) => {
            const value = formData.get(field);
            return typeof value === 'string' ? value : '';
        };
        const projectIds = formData.getAll('project').filter((id): id is string => typeof id === 'string').slice(0, 500);
        const client = await createClient(context, { name: text('name'), description: text('description') }, projectIds);
        revalidatePath('/app', 'layout');
        return client;
    }, 'The client is added.');
}
