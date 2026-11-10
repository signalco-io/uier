'use server';

import { revalidatePath } from 'next/cache';
import { actionResult, type ActionState } from '@/src/lib/app/actionResult';
import { appContextOrThrow } from '@/src/lib/app/context';
import { nameSchema, updateUserName } from '@/src/lib/app/users';
import { setUserToolbarLanguage } from '@/src/lib/app/toolbarLanguage';

export async function updateNameAction(_: ActionState, formData: FormData): Promise<ActionState> {
    return await actionResult(async () => {
        const context = await appContextOrThrow();
        const name = nameSchema.parse(formData.get('name') ?? '');
        await updateUserName(context.user.id, name);
        revalidatePath('/app', 'layout');
    }, 'Your name is saved.');
}

/** The account's toolbar language (`default` clears it), the same preference as the toolbar's Options */
export async function setToolbarLanguageAction(_: ActionState, formData: FormData): Promise<ActionState> {
    return await actionResult(async () => {
        const context = await appContextOrThrow();
        const choice = formData.get('toolbarLanguage');
        await setUserToolbarLanguage(context.user.id, choice === 'default' ? null : choice);
        revalidatePath('/app', 'layout');
    }, 'Your toolbar language is saved.');
}
