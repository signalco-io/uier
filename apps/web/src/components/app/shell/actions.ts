'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { KnownPages } from '@/src/knownPages';
import { endSession } from '@/src/lib/app/session';
import { appContextOrThrow } from '@/src/lib/app/context';
import { selectWorkspace } from '@/src/lib/app/workspaceCookie';
import { parseActionInput } from '@/src/lib/app/validation';
import { actionResult, type ActionState } from '@/src/lib/app/actionResult';
import { createWorkspace } from '@/src/lib/app/workspaces';
import { safeNextPath } from '@/src/lib/app/signIn';
import { appCookieOptions } from '@/src/lib/app/session';
import { cookieNames } from '@/src/lib/cookieNames';
import { formatProjectOrder, type ProjectOrder } from '@/src/lib/app/projectOrder';
import { PROJECT_ORDER_COOKIE_NAME } from '@/src/lib/app/projectOrderCookie';
import { projectOrderActionSchema, switchWorkspaceActionSchema } from './actionSchemas';

export async function signOutAction() {
    const hasAnother = await endSession();
    redirect(hasAnother ? KnownPages.App : KnownPages.AppSignIn);
}

/**
 * A fresh email sign-in for a step that needs the account email proven in the last 10 minutes (joining or
 * adding an email domain, `emailProof.ts`): keeps other accounts signed in and opens the email form, back to `next` afterwards.
 */
export async function signInAgainWithEmailAction(formData: FormData) {
    const next = safeNextPath(formData.get('next')) ?? KnownPages.App;
    redirect(`${KnownPages.AppSignIn}?${new URLSearchParams({ next, with: 'email', add: '1' })}`);
}

export async function switchWorkspaceAction(workspaceId: string) {
    const input = parseActionInput(switchWorkspaceActionSchema, { workspaceId });
    const context = await appContextOrThrow();
    if (!context.memberships.some(m => m.workspace.id === input.workspaceId))
        return;

    await selectWorkspace(input.workspaceId);
    redirect(KnownPages.App);
}

/** Remembers how this browser lists the sidebar's projects; only a preference, with nothing about the person */
export async function saveProjectOrderAction(order: ProjectOrder) {
    const input = parseActionInput(projectOrderActionSchema, order);
    await appContextOrThrow();
    (await cookies()).set(PROJECT_ORDER_COOKIE_NAME, formatProjectOrder(input), appCookieOptions(cookieNames.projectOrder.lifetime));
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
