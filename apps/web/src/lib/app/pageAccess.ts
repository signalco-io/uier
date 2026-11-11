import type { NextRequest } from 'next/server.js';
import { KnownPageLinks, KnownPages } from '../../knownPages';
import { cookieNames, readMigratingCookie } from '../cookieNames';
import { PUBLIC_WORKSPACE_ID } from '../comments/publicProjectPolicy';
import { isUierFeedbackProject } from '../comments/publicProject';
import { isIntegrationProvider } from '../integrations/model';
import { loadAppContext } from './requestContext';
import { requestSessionUser, sessionEmailProof } from './sessionIdentity';
import { getVisibleProject, listVisibleProjects } from './projects';
import { loadClients, projectClients } from './clients';
import { safeNextPath } from './signIn';
import { joinNextPath } from './signInDestination';
import { freshlyProvenEmail } from './emailProof';
import { domainJoinOffers } from './workspaceDomains';
import { resolveCommentAuthorFilter } from './commentAuthors';
import { getTeam } from './teams';
import { listMembersWithUsers } from './members';
import { reviewTarget } from './review';

type PageAccess = { redirect: string } | { status: 404; review?: boolean } | undefined;

/** Finish status/redirect decisions before a static shell can stream. Pages and actions
 * still authorize their own reads/writes; this result never grants access to data. */
export async function appPageAccess(request: NextRequest): Promise<PageAccess> {
    const { pathname, searchParams } = request.nextUrl;
    const query = (name: string) => {
        const values = searchParams.getAll(name);
        return values.length === 1 ? values[0] : undefined;
    };
    if (pathname === '/app/unavailable' || pathname === '/app/review-unavailable') return { status: 404 };
    const user = await requestSessionUser(request);
    if (pathname === KnownPages.AppSignIn) {
        if (user && query('add') !== '1')
            return { redirect: safeNextPath(query('next')) ?? KnownPages.App };
        return;
    }
    if (!user) return { redirect: `${KnownPages.AppSignIn}?${new URLSearchParams({ next: pathname + request.nextUrl.search })}` };
    if (pathname === KnownPages.AppWelcome && !user.welcomePending) return { redirect: KnownPages.App };
    if (pathname === KnownPages.AppJoin) {
        const proof = sessionEmailProof(readMigratingCookie(request.cookies, cookieNames.session), user);
        if (freshlyProvenEmail(user.email, proof) && !(await domainJoinOffers(user, proof)).length)
            return { redirect: joinNextPath(query('next')) };
        return;
    }
    const context = await loadAppContext(user, readMigratingCookie(request.cookies, cookieNames.workspace));
    if (!context) return { redirect: KnownPages.AppSignIn };
    if (pathname === KnownPages.App) {
        if (user.welcomePending) return { redirect: KnownPages.AppWelcome };
        const projects = await listVisibleProjects(context);
        return { redirect: !projects.length && context.isAdmin ? KnownPages.AppNewProject : KnownPages.AppProjects };
    }
    if (pathname === KnownPages.AppWorkspace)
        return { redirect: context.isAdmin && context.workspace.id !== PUBLIC_WORKSPACE_ID ? KnownPages.AppUsers : KnownPages.AppClients };
    const client = query('client');
    if (pathname === KnownPages.AppProjects && client?.startsWith('name:')) {
        const [projects, clients] = await Promise.all([listVisibleProjects(context), loadClients(context.workspace.id)]);
        const named = projectClients(projects, clients).find(({ name }) => client === `name:${name}`);
        if (named) return { redirect: KnownPageLinks.clientProjects(named.id, query('status') === 'done' ? 'done' : 'active') };
    }
    const review = /^\/app\/review\/([^/]+)$/.exec(pathname);
    if (review) {
        const target = await reviewTarget(context, review[1]!, query('url') ?? null, query('comment') ?? null);
        return target ? { redirect: target } : { status: 404, review: true };
    }
    const projectPath = /^\/app\/projects\/([^/]+)(?:\/(.*))?$/.exec(pathname);
    if (projectPath && projectPath[1] !== 'new') {
        const project = await getVisibleProject(context, projectPath[1]!);
        if (!project) return { status: 404 };
        const section = projectPath[2] ?? '';
        if (section === 'install' && query('onboarding') !== '1')
            return { redirect: KnownPageLinks.projectInstall(project.id) };
        const configurable = context.isAdmin && context.workspace.id !== PUBLIC_WORKSPACE_ID;
        if (/^settings\/(?:review|people|environments|danger-zone|integrations)(?:\/|$)/.test(section) && !configurable)
            return { status: 404 };
        if (section === 'settings' && !configurable)
            return { redirect: KnownPageLinks.projectSettings(project.id, 'notifications') };
        if (section.startsWith('settings/integrations')) {
            const provider = section.split('/')[2];
            if (isUierFeedbackProject(project.id) || (provider !== undefined && !isIntegrationProvider(provider))) return { status: 404 };
        }
        const author = query('author');
        if (!section && author && !await resolveCommentAuthorFilter(context, project, author)) return { status: 404 };
    }
    const teamArea = /^\/app\/workspace\/(?:teams|activity)(?:\/|$)/.test(pathname)
        || /^\/app\/workspace\/users\//.test(pathname);
    if (teamArea && (!context.isAdmin || context.workspace.id === PUBLIC_WORKSPACE_ID)) return { status: 404 };
    const team = /^\/app\/workspace\/teams\/([^/]+)$/.exec(pathname);
    if (team && !await getTeam(context.workspace.id, team[1]!)) return { status: 404 };
    const person = /^\/app\/workspace\/users\/([^/]+)$/.exec(pathname);
    if (person && !(await listMembersWithUsers(context.workspace.id)).some(value => value.user && value.member.userId === person[1]))
        return { status: 404 };
    if ([KnownPages.AppNewProject, '/app/workspace/users', '/app/workspace/settings'].includes(pathname)) {
        if (!context.isAdmin) return { redirect: KnownPages.App };
        if (context.workspace.id === PUBLIC_WORKSPACE_ID) return { redirect: KnownPages.AppProjects };
    }
}
