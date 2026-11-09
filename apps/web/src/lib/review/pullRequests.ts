import type { DbProject } from '../app/model';
import { apiErrors } from '../comments/http';
import { parsePullRequestLink } from '../comments/pullRequestLinks';
import { withThreadActivity } from '../comments/activity';
import { actorAuthorId, type ProjectActor } from './actor';
import { canTriageProject, changeComment } from './comments';

/** Canonical, naturally idempotent links. Ownership is server-derived and retained across retries. */
export async function setProjectCommentPullRequest(project: DbProject, actor: ProjectActor, id: string, value: string, remove = false) {
    if (typeof value !== 'string' || value.length > 2048) throw apiErrors.invalidRequest('Enter a supported pull request URL.');
    const link = parsePullRequestLink(value.trim());
    if (!link) throw apiErrors.invalidRequest('Enter a GitHub, GitLab or Azure DevOps pull request URL.');
    return changeComment(project, actor, id, () => canTriageProject(project, actor), comment => {
        const links = comment.pullRequests ?? [];
        const existing = links.find(saved => saved.url.toLowerCase() === link.url.toLowerCase());
        const addedBy = actorAuthorId(actor)!;
        if (remove && existing && existing.addedBy !== addedBy) throw apiErrors.forbidden('You can only remove pull requests you linked.');
        if (remove ? !existing : existing) return comment;
        if (!remove && links.length >= 20) throw apiErrors.invalidRequest('A thread can have at most 20 manually linked pull requests.');
        return { ...withThreadActivity(comment, addedBy), pullRequests: remove ? links.filter(saved => saved !== existing) : [...links, { url: link.url, addedBy }] };
    });
}
