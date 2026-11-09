'use server';

import { redirect } from 'next/navigation';
import { KnownPageLinks } from '@/src/knownPages';
import { appContextOrThrow } from '@/src/lib/app/context';
import { parseActionInput } from '@/src/lib/app/validation';
import { projectInOtherWorkspace } from '@/src/lib/app/usage';
import { selectWorkspace } from '@/src/lib/app/workspaceCookie';
import { openProjectWorkspaceUsageSchema } from './actionSchemas';

/**
 * Opens the workspace of the project a usage link named, back on its usage. The workspace comes from the
 * person's own memberships and the project's current access, never from the request.
 */
export async function openProjectWorkspaceUsageAction(project: string) {
    const input = parseActionInput(openProjectWorkspaceUsageSchema, { project });
    const context = await appContextOrThrow();
    const found = await projectInOtherWorkspace(context, input.project);
    if (found)
        await selectWorkspace(found.workspace.id);
    redirect(KnownPageLinks.workspaceUsage(input.project));
}
