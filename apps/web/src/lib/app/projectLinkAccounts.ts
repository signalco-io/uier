import { KnownPages } from '../../knownPages';
import { browserSessions, type AccountCookieReader } from './browserAccounts';
import { loadAppContext } from './requestContext';
import { findProject, findReviewProject, getVisibleProject } from './projects';
import { safeNextPath } from './signIn';
import { cookieNames, readMigratingCookie } from '../cookieNames';

/** Only signed-in browser identities with current project access become choices. */
export async function projectLinkAccounts(jar: AccountCookieReader, next: unknown) {
    const path = safeNextPath(next);
    if (!path) return [];
    const url = new URL(path, 'https://uier.invalid');
    const match = /^\/app\/(projects|review)\/([^/]+)(?:\/.*)?$/.exec(url.pathname);
    if (!match || match[2] === 'new' || url.pathname.endsWith('/screenshot')) return [];
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
        // Already selected and authorized: ordinary page validation handles missing comments etc.
        if (session.active && selected.workspace.id === project.workspaceId)
            return [];
        choices.push({ userId: session.user.id, email: session.user.email, workspaceId: context.workspace.id, workspaceName: context.workspace.name });
    }
    return choices;
}

export function projectLinkSwitchPath(next: string) {
    return `${KnownPages.AppSwitchProjectAccount}?${new URLSearchParams({ next })}`;
}
