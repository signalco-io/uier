import { ApiError } from '../comments/http';
import { getProjectComment } from '../review/comments';
import { commentPath } from '../comments/dto';
import { feedbackSource } from './environments';
import type { AppContext } from './context';
import type { DbMember } from './model';
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
    return await memberReviewTarget(context.user.id, projectId, requestedUrl, commentId, context.memberships.map(m => m.member));
}

/** {@link reviewTarget} for a user (e.g. right after accepting an invitation) */
export async function memberReviewTarget(userId: string, projectId: string, requestedUrl: string | null, commentId?: string | null, knownMemberships: DbMember[] = []) {
    const project = await findProject(projectId);
    if (!project)
        return null;

    const member = knownMemberships.find(m => m.workspaceId === project.workspaceId)
        ?? await getMember(project.workspaceId, userId);
    if (!member || !memberCanAccessProject(member, project.id))
        return null;

    let url = project.urls[0];
    if (commentId) {
        if (!commentIdPattern.test(commentId)) return null;
        const comment = await getProjectComment(project, { kind: 'member', userId, name: '', isAdmin: member.role === 'admin' }, commentId).catch(error => { if (error instanceof ApiError && error.status === 404) return null; throw error; });
        if (!comment || !feedbackSource(project, comment.origin).available) return null;
        url = `${comment.origin}${commentPath(comment)}`;
    }
    if (requestedUrl && !commentId) {
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
    target.searchParams.set(REVIEW_TOKEN_PARAM, await issueReviewCode(userId, project.id));
    if (commentId && commentIdPattern.test(commentId))
        target.searchParams.set(REVIEW_COMMENT_PARAM, commentId);
    return target.toString();
}
