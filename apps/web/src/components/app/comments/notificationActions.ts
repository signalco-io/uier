'use server';

import { revalidatePath } from 'next/cache';
import { appContextOrThrow } from '@/src/lib/app/context';
import { getVisibleProject } from '@/src/lib/app/projects';
import { appActor } from '@/src/lib/app/projectComments';
import { actionResult, UserFacingError } from '@/src/lib/app/actionResult';
import { followThread, setProjectMuted } from '@/src/lib/notifications/preferences';
import { ApiError } from '@/src/lib/comments/http';
import { KnownPageLinks } from '@/src/knownPages';

export async function updateNotificationAction(projectId: string, threadId: string | undefined, enabled: boolean) {
    return actionResult(async () => {
        const context = await appContextOrThrow();
        const project = await getVisibleProject(context, projectId);
        if (!project) throw new UserFacingError('This project no longer exists.');
        try {
            if (threadId) await followThread(project, appActor(context), threadId, enabled);
            else await setProjectMuted(project, appActor(context), enabled);
        } catch (error) {
            if (error instanceof ApiError) throw new UserFacingError(error.message);
            throw error;
        }
        revalidatePath(KnownPageLinks.project(projectId));
    });
}
