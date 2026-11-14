'use server';

import { appContextOrThrow } from '../../../lib/app/context';
import { listProjectMembers } from '../../../lib/app/members';
import { getVisibleProject, listVisibleProjects } from '../../../lib/app/projects';
import { parseActionInput } from '../../../lib/app/validation';
import { PUBLIC_WORKSPACE_ID } from '../../../lib/comments/publicProjectPolicy';
import { projectHeaderActionSchema } from './actionSchemas';

/** How many avatars the header's access popover shows before the count of the others */
const PEOPLE_PREVIEW = 4;

export type ProjectPeoplePreview = {
    /** Everyone with access to the project */
    count: number;
    /** The first few of them, by name */
    people: { id: string; name: string; avatarUrl?: string }[];
};

/**
 * The people with access to a project, for the header's access popover; loaded when it opens (uier #420).
 * Only for people who can see the project, and never for uier's own feedback workspace, which every account joins.
 */
export async function projectPeoplePreviewAction(projectId: string): Promise<ProjectPeoplePreview | null> {
    const input = parseActionInput(projectHeaderActionSchema, { projectId });
    const context = await appContextOrThrow();
    const project = await getVisibleProject(context, input.projectId);
    if (!project || project.workspaceId === PUBLIC_WORKSPACE_ID)
        return null;
    const members = await listProjectMembers(project.workspaceId, project.id);
    return {
        count: members.length,
        people: members.slice(0, PEOPLE_PREVIEW).map(({ member, name, avatarUrl }) => ({ id: member.userId, name, ...(avatarUrl ? { avatarUrl } : {}) }))
    };
}

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
