import type { AppContext } from './context';
import { findProject, projectOrigins, reviewUrl } from './projects';
import { getMember, memberCanAccessProject } from './workspaces';

/**
 * Where a review link of the project goes for this person: the requested page (it must be on
 * one of the project's sites) or the main site, with `?toolbar-code=<project code>`. `null` when
 * the project does not exist or the person has no access to it (in any of their workspaces).
 */
export async function reviewTarget(context: AppContext, projectId: string, requestedUrl: string | null) {
    const project = await findProject(projectId);
    if (!project)
        return null;

    const member = context.memberships.find(m => m.workspace.id === project.workspaceId)?.member
        ?? await getMember(project.workspaceId, context.user.id);
    if (!member || !memberCanAccessProject(member, project.id))
        return null;

    let url = project.urls[0];
    if (requestedUrl) {
        try {
            const requested = new URL(requestedUrl);
            if (projectOrigins(project).includes(requested.origin))
                url = requested.toString();
        } catch {
            // Not a URL: the main site
        }
    }
    return url ? reviewUrl(url, project.id) : null;
}
