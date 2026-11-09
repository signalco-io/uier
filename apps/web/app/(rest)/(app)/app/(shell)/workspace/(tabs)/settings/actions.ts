'use server';

import { revalidatePath } from 'next/cache';
import { actionResult, type ActionState } from '@/src/lib/app/actionResult';
import { appContextOrThrow } from '@/src/lib/app/context';
import { renameWorkspace, setWorkspaceAiTitles, setWorkspaceRewriteInstructions, setWorkspaceFeedbackTypes } from '@/src/lib/app/workspaces';

export async function renameWorkspaceAction(_: ActionState, formData: FormData): Promise<ActionState> {
    return await actionResult(async () => {
        const context = await appContextOrThrow({ admin: true });
        await renameWorkspace(context.workspace.id, context.user.id, formData.get('name') ?? '');
        revalidatePath('/app', 'layout');
    }, 'The workspace name is saved.');
}

/** AI thread titles for the workspace's projects; projects can override it */
export async function setWorkspaceAiTitlesAction(_: ActionState, formData: FormData): Promise<ActionState> {
    return await actionResult(async () => {
        const context = await appContextOrThrow({ admin: true });
        const enabled = formData.get('aiTitles');
        await setWorkspaceAiTitles(context.workspace.id, context.user.id, enabled === 'true' ? true : enabled === 'false' ? false : enabled);
        revalidatePath('/app', 'layout');
    }, 'The thread title setting is saved.');
}

export async function setWorkspaceRewriteInstructionsAction(_: ActionState, formData: FormData): Promise<ActionState> {
    return await actionResult(async () => {
        const context = await appContextOrThrow({ admin: true });
        await setWorkspaceRewriteInstructions(context.workspace.id, context.user.id, formData.get('rewriteInstructions') ?? '');
        revalidatePath('/app', 'layout');
    }, 'The rewrite instructions are saved.');
}

export async function setWorkspaceFeedbackTypesAction(_: ActionState, formData: FormData): Promise<ActionState> {
    return await actionResult(async () => {
        const context = await appContextOrThrow({ admin: true });
        await setWorkspaceFeedbackTypes(context.workspace.id, context.user.id, JSON.parse(String(formData.get('feedbackTypes') ?? 'null')));
        revalidatePath('/app', 'layout');
    }, 'Saved. Projects using workspace defaults get these feedback types on their next page load.');
}
