'use server';

import { appContextOrThrow } from '../../../lib/app/context';
import { getVisibleProject, listVisibleProjects } from '../../../lib/app/projects';
import { parseActionInput } from '../../../lib/app/validation';
import { projectHeaderActionSchema } from './actionSchemas';

/** How many of the projects the person can see are for the project's client, for the header's client popover (uier #421) */
export async function projectClientProjectsAction(projectId: string): Promise<{ active: number; done: number } | null> {
    const input = parseActionInput(projectHeaderActionSchema, { projectId });
    const context = await appContextOrThrow();
    const project = await getVisibleProject(context, input.projectId);
    if (!project?.clientId)
        return null;
    const projects = (await listVisibleProjects(context)).filter(other => other.clientId === project.clientId);
    const done = projects.filter(other => other.status === 'done').length;
    return { active: projects.length - done, done };
}
