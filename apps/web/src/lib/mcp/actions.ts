'use server';

import { revalidatePath } from 'next/cache';
import { appContextOrThrow } from '../app/context';
import { actionResult, type ActionState } from '../app/actionResult';
import { ApiError } from '../comments/http';
import { UserFacingError } from '../app/actionResult';
import { createMcpCredential, revokeMcpCredential } from './credentials';
import { parseActionInput } from '../app/validation';
import { revokeCredentialActionSchema } from './actionSchemas';

export async function createMcpCredentialAction(_previous: ActionState<{ token: string }>, form: FormData) {
    return actionResult(async () => {
        const context = await appContextOrThrow();
        try {
            const { token } = await createMcpCredential(context, { name: form.get('name'), projectIds: form.getAll('projectIds'), scopes: form.getAll('scopes'), days: 30 });
            revalidatePath('/app/account');
            return { token };
        } catch (error) {
            if (error instanceof ApiError) throw new UserFacingError(error.message);
            throw error;
        }
    });
}

export async function revokeMcpCredentialAction(id: string) {
    const input = parseActionInput(revokeCredentialActionSchema, { id });
    const context = await appContextOrThrow();
    await revokeMcpCredential(context.user.id, input.id);
    revalidatePath('/app/account');
}
