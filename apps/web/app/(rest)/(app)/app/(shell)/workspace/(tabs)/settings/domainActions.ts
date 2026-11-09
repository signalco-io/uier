'use server';

import { revalidatePath } from 'next/cache';
import { KnownPages } from '@/src/knownPages';
import { actionResult, type ActionState } from '@/src/lib/app/actionResult';
import { appContextOrThrow } from '@/src/lib/app/context';
import { getSessionEmailProof } from '@/src/lib/app/session';
import { parseActionInput } from '@/src/lib/app/validation';
import { addWorkspaceDomain, removeWorkspaceDomain, updateWorkspaceDomainTeams } from '@/src/lib/app/workspaceDomains';
import { domainActionSchema } from './domainActionSchemas';

const teamIdsFrom = (formData: FormData) => formData.getAll('team').filter((id): id is string => typeof id === 'string');

/** Adds the admin's own email domain, with the teams people who join get; their sign-in must have proved the email recently */
export async function addDomainAction(_: ActionState, formData: FormData): Promise<ActionState> {
    return await actionResult(async () => {
        const context = await appContextOrThrow({ admin: true });
        await addWorkspaceDomain(context, { domain: formData.get('domain') ?? '', teamIds: teamIdsFrom(formData) },
            await getSessionEmailProof(context.user));
        revalidatePath(KnownPages.AppSettings);
    });
}

export async function updateDomainTeamsAction(_: ActionState, formData: FormData): Promise<ActionState> {
    return await actionResult(async () => {
        const context = await appContextOrThrow({ admin: true });
        await updateWorkspaceDomainTeams(context, { domain: formData.get('domain') ?? '', teamIds: teamIdsFrom(formData) });
        revalidatePath(KnownPages.AppSettings);
    });
}

export async function removeDomainAction(domain: string): Promise<ActionState> {
    return await actionResult(async () => {
        const input = parseActionInput(domainActionSchema, { domain });
        const context = await appContextOrThrow({ admin: true });
        await removeWorkspaceDomain(context, input.domain);
        revalidatePath(KnownPages.AppSettings);
    });
}
