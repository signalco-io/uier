import { cache } from 'react';
import { notFound } from 'next/navigation';
import { requireAppContext } from '@/src/lib/app/context';
import { getVisibleProjectForPage as getVisibleProject } from '@/src/lib/app/projectLinkPage';
import { PUBLIC_WORKSPACE_ID } from '@/src/lib/comments/publicProjectPolicy';

/** The viewer and the project of a settings page; admins configure it (the uier workspace's settings are fixed) */
export const projectSettingsContext = cache(async (projectId: string) => {
    const context = await requireAppContext();
    const project = await getVisibleProject(context, projectId);
    if (!project)
        notFound();
    return { context, project, canConfigure: context.isAdmin && project.workspaceId !== PUBLIC_WORKSPACE_ID };
});

/** The same for a section only admins see: anyone else gets a 404 */
export async function configurableProject(projectId: string) {
    const settings = await projectSettingsContext(projectId);
    if (!settings.canConfigure)
        notFound();
    return settings;
}
