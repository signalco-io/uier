'use server';

import { revalidatePath } from 'next/cache';
import { actionResult, type ActionState } from '@/src/lib/app/actionResult';
import { appContextOrThrow } from '@/src/lib/app/context';
import { nameSchema, updateUserName } from '@/src/lib/app/users';

export async function updateNameAction(_: ActionState, formData: FormData): Promise<ActionState> {
    return await actionResult(async () => {
        const context = await appContextOrThrow();
        const name = nameSchema.parse(formData.get('name') ?? '');
        await updateUserName(context.user.id, name);
        revalidatePath('/app', 'layout');
    }, 'Your name is saved.');
}
