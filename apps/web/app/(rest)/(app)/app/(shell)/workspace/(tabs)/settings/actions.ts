'use server';

import { revalidatePath } from 'next/cache';
import { actionResult, type ActionState } from '@/src/lib/app/actionResult';
import { appContextOrThrow } from '@/src/lib/app/context';
import { renameWorkspace } from '@/src/lib/app/workspaces';

export async function renameWorkspaceAction(_: ActionState, formData: FormData): Promise<ActionState> {
    return await actionResult(async () => {
        const context = await appContextOrThrow({ admin: true });
        await renameWorkspace(context.workspace.id, context.user.id, formData.get('name') ?? '');
        revalidatePath('/app', 'layout');
    }, 'The workspace name is saved.');
}
