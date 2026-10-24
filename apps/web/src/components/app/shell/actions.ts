'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { KnownPages } from '@/src/knownPages';
import { endSession } from '@/src/lib/app/session';
import { appContextOrThrow, WORKSPACE_COOKIE_NAME } from '@/src/lib/app/context';
import { isLocalRuntime } from '@/src/lib/comments/environment';

export async function signOutAction() {
    await endSession();
    redirect(KnownPages.AppSignIn);
}

export async function switchWorkspaceAction(workspaceId: string) {
    const context = await appContextOrThrow();
    if (!context.memberships.some(m => m.workspace.id === workspaceId))
        return;

    (await cookies()).set(WORKSPACE_COOKIE_NAME, workspaceId, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 365 * 24 * 60 * 60,
        secure: !isLocalRuntime()
    });
    redirect(KnownPages.App);
}
