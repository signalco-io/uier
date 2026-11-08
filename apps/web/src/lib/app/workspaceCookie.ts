import { cookies } from 'next/headers';
import { WORKSPACE_COOKIE_NAME } from './context';
import { isLocalRuntime } from '../comments/environment';

/**
 * Opens the workspace on the next request (`getAppContext` reads this cookie). Only a server action
 * that has checked the person's membership may call it; an unknown workspace falls back to their own.
 */
export async function selectWorkspace(workspaceId: string) {
    (await cookies()).set(WORKSPACE_COOKIE_NAME, workspaceId, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 365 * 24 * 60 * 60,
        secure: !isLocalRuntime()
    });
}
