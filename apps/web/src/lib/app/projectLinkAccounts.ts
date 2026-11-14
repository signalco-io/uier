import { cache } from 'react';
import { KnownPages } from '../../knownPages';
import { browserSessions, type AccountCookieReader } from './browserAccounts';
import { loadAppContext } from './requestContext';
import { findProject, findReviewProject, getVisibleProject } from './projects';
import { safeNextPath } from './signIn';
import { cookieNames, readMigratingCookie } from '../cookieNames';
import { ApiError } from '../comments/http';
import { PUBLIC_WORKSPACE_ID } from '../comments/publicProjectPolicy';
import { isUierFeedbackProject } from '../comments/publicProject';
import { isIntegrationProvider } from '../integrations/model';
import { getProjectComment } from '../review/comments';
import { feedbackSource } from './environments';
import { resolveCommentAuthorFilter } from './commentAuthors';
import type { AppContext } from './context';
import type { DbProject } from './model';

/** Match the destination's permissions, rather than combining a project's grants across accounts. */
async function canOpenLink(context: AppContext, project: DbProject, url: URL, section: string, review: boolean) {
    const query = (name: string) => {
        const values = url.searchParams.getAll(name);
        return values.length === 1 ? values[0] : undefined;
    };
    if (/^settings\/(?:review|people|environments|danger-zone|integrations)(?:\/|$)/.test(section)) {
        if (!context.isAdmin || context.workspace.id === PUBLIC_WORKSPACE_ID) return false;
        if (section.startsWith('settings/integrations')) {
            const provider = section.split('/')[2];
            if (isUierFeedbackProject(project.id) || (provider !== undefined && !isIntegrationProvider(provider))) return false;
        }
    }
    if (!section && !review && query('author') && !await resolveCommentAuthorFilter(context, project, query('author')!)) return false;
    const commentId = query('comment');
    if ((!section || review) && commentId) {
        if (!/^comment_[A-Za-z0-9_-]{1,64}$/.test(commentId)) return !review;
        const actor = { kind: 'member' as const, userId: context.user.id, name: context.user.name, isAdmin: context.isAdmin };
        try {
            const comment = await getProjectComment(project, actor, commentId);
            // A project page can still open without its old comment. A hidden private
            // comment instead throws 404, so only accounts that may see it qualify.
            return comment ? !review || feedbackSource(project, comment.origin).available : !review;
        } catch (error) {
            if (error instanceof ApiError && error.status === 404) return false;
            throw error;
        }
    }
    return true;
}

/** Only signed-in browser identities with current project access become choices. */
export const projectLinkAccounts = cache(async (jar: AccountCookieReader, next: unknown) => {
    const path = safeNextPath(next);
    if (!path) return [];
    const url = new URL(path, 'https://uier.invalid');
    const match = /^\/app\/(projects|review)\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
    if (!match || match[2] === 'new' || url.pathname.endsWith('/screenshot')) return [];
    const section = match[3] ?? '';
    // Only real resource pages can offer identities; unknown paths retain their normal 404.
    if (match[1] === 'review' ? Boolean(section) : !/^(?:|install|page-checks|settings(?:\/(?:notifications|installation|review|people|environments|danger-zone|integrations(?:\/[^/]+)?))?)$/.test(section)) return [];
    const project = await findProject(match[2]!) ?? (match[1] === 'review' ? await findReviewProject(match[2]!) : null);
    if (!project) return [];
    const sessions = await browserSessions(jar);
    if (!sessions.some(session => session.active)) return [];
    const choices = [];
    for (const session of sessions) {
        const selected = await loadAppContext(session.user, readMigratingCookie(jar, cookieNames.workspace));
        const membership = selected?.memberships.find(value => value.workspace.id === project.workspaceId);
        if (!selected || !membership) continue;
        const context = { ...selected, ...membership, isAdmin: membership.member.role === 'admin' };
        if (!await getVisibleProject(context, project.id)) continue;
        if (!await canOpenLink(context, project, url, section, match[1] === 'review')) continue;
        // An already selected account that can open the exact resource needs no resolution.
        if (session.active && selected.workspace.id === project.workspaceId)
            return [];
        choices.push({ userId: session.user.id, email: session.user.email, workspaceId: context.workspace.id, workspaceName: context.workspace.name });
    }
    return choices;
});

export function projectLinkSwitchPath(next: string) {
    return `${KnownPages.AppSwitchProjectAccount}?${new URLSearchParams({ next })}`;
}
