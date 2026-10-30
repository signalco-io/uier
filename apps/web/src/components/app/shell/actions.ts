'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { KnownPages } from '@/src/knownPages';
import { endSession } from '@/src/lib/app/session';
import { appContextOrThrow, WORKSPACE_COOKIE_NAME } from '@/src/lib/app/context';
import { isLocalRuntime } from '@/src/lib/comments/environment';
import { parseActionInput } from '@/src/lib/app/validation';
import { actionResult, type ActionState } from '@/src/lib/app/actionResult';
import { createWorkspace } from '@/src/lib/app/workspaces';
import { switchWorkspaceActionSchema } from './actionSchemas';

export async function signOutAction() {
    await endSession();
    redirect(KnownPages.AppSignIn);
}

async function selectWorkspace(workspaceId: string) {
    (await cookies()).set(WORKSPACE_COOKIE_NAME, workspaceId, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 365 * 24 * 60 * 60,
        secure: !isLocalRuntime()
    });
}

export async function switchWorkspaceAction(workspaceId: string) {
    const input = parseActionInput(switchWorkspaceActionSchema, { workspaceId });
    const context = await appContextOrThrow();
    if (!context.memberships.some(m => m.workspace.id === input.workspaceId))
        return;

    await selectWorkspace(input.workspaceId);
    redirect(KnownPages.App);
}

/** A new workspace with the signed-in person as its admin, opened right away (on its first project) */
export async function createWorkspaceAction(_: ActionState, formData: FormData): Promise<ActionState> {
    const result = await actionResult(async () => {
        const context = await appContextOrThrow();
        return await createWorkspace(context.user, formData.get('name') ?? '');
    });
    if (!result?.ok)
        return result;

    await selectWorkspace(result.data.id);
    revalidatePath('/app', 'layout');
    redirect(KnownPages.App);
}
