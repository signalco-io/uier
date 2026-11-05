'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { KnownPages } from '@/src/knownPages';
import { actionResult, type ActionState } from '@/src/lib/app/actionResult';
import { appContextOrThrow } from '@/src/lib/app/context';
import { finishWelcome, nameSchema } from '@/src/lib/app/users';
import { renameWorkspace, workspaceNameSchema } from '@/src/lib/app/workspaces';
import { welcomeWorkspace } from './welcomeWorkspace';

/** Saves the name (and the new workspace's name), ends the first-run step and opens the app */
export async function completeWelcomeAction(_: ActionState, formData: FormData): Promise<ActionState> {
    const result = await actionResult(async () => {
        const context = await appContextOrThrow();
        const name = nameSchema.parse(formData.get('name') ?? '');
        const workspace = welcomeWorkspace(context);
        // Both are checked before either is saved
        const workspaceName = workspace ? workspaceNameSchema.parse(formData.get('workspace') ?? '') : undefined;
        if (workspace && workspaceName && workspaceName !== workspace.name)
            await renameWorkspace(workspace.id, context.user.id, workspaceName);
        await finishWelcome(context.user.id, name);
        revalidatePath('/app', 'layout');
    });
    if (!result?.ok)
        return result;
    redirect(KnownPages.App);
}

/** Ends the first-run step without changing anything (Account and Workspace settings still can) */
export async function skipWelcomeAction(_: ActionState): Promise<ActionState> {
    const result = await actionResult(async () => {
        const context = await appContextOrThrow();
        await finishWelcome(context.user.id);
    });
    if (!result?.ok)
        return result;
    redirect(KnownPages.App);
}
