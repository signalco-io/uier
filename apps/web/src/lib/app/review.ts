import type { AppContext } from './context';
import { findProject, projectOrigins, reviewUrl } from './projects';
import { getMember, memberCanAccessProject } from './workspaces';
import { issueReviewCode } from '../review/actor';

/** Query parameters the toolbar reads on a project's site (packages/toolbar/src/review) */
export const REVIEW_TOKEN_PARAM = 'uier-token';
export const REVIEW_COMMENT_PARAM = 'uier-comment';

const commentIdPattern = /^comment_[A-Za-z0-9_-]{1,64}$/;

/**
 * Where a review link of the project goes for this person: the requested page (it must be on one
 * of the project's sites) or the main site, with the toolbar's review link parameter
 * (`?toolbar-code=<project code>`), a single-use code the toolbar exchanges for a review token
 * (`uier-token`) and optionally a comment to open (`uier-comment`).
 * `null` when the project does not exist or the person has no access to it.
 */
export async function reviewTarget(context: AppContext, projectId: string, requestedUrl: string | null, commentId?: string | null) {
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
    if (!url)
        return null;

    const target = new URL(reviewUrl(url, project.id));
    target.searchParams.set(REVIEW_TOKEN_PARAM, await issueReviewCode(context.user.id, project.id));
    if (commentId && commentIdPattern.test(commentId))
        target.searchParams.set(REVIEW_COMMENT_PARAM, commentId);
    return target.toString();
}
