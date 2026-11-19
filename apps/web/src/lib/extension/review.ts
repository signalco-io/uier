import { z } from 'zod';
import { createProject, ProjectGoneError, projectOrigins, findProject, listProjects, reserveProjectCreation } from '../app/projects';
import { hasExtensionCapability } from './sessions';
import { getMember, getWorkspace, listUserMemberships } from '../app/workspaces';
import type { DbMember } from '../app/model';
import { UserFacingError } from '../app/actionErrors';
import { PUBLIC_WORKSPACE_ID } from '../comments/publicProjectPolicy';
import type { Limit } from '../comments/rateLimits';
import { getUser } from '../app/users';
import { ensureProjectPublicId } from '../app/projectPublicIds';
import { memberActor } from '../review/actor';
import { ApiError, apiErrors, parseJsonBody } from '../comments/http';
import { extensionSession, loadExtensionSession, readScope, scopeToken } from './auth';
import type { ReviewApiContext } from '../review/http';

export const originSchema = z.string().max(512).refine(value => {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && url.origin === value; } catch { return false; }
}, 'An exact HTTP(S) origin is required.');
export async function matchingProjects(request: Request) {
    const session = await extensionSession(request);
    const origin = originSchema.safeParse(new URL(request.url).searchParams.get('origin'));
    if (!origin.success) throw apiErrors.invalidRequest('An exact HTTP(S) origin is required.');
    const user = await getUser(session.userId);
    const { workspaces, ...site } = await projectsForSite(session.userId, origin.data);
    // A sign-in from before creating was offered approved reviewing alone: the popup asks for a new one instead
    const approved = hasExtensionCapability(session, 'create-projects');
    return Response.json({ ...site, workspaces: approved ? workspaces : [], ...(!approved && workspaces.length > 0 ? { approveCreate: true } : {}),
        account: user && { name: user.name, email: user.email } });
}
/**
 * Who may create a project in a workspace: its admins, as on the app's Create project (`createProjectAction`),
 * and nobody in uier's own workspace, which takes no project (`assertMutableWorkspace`).
 */
function mayCreateProjects(member: Pick<DbMember, 'role' | 'workspaceId'>) {
    return member.role === 'admin' && member.workspaceId !== PUBLIC_WORKSPACE_ID;
}
/** Projects one account creates from the extension in an hour */
export const siteProjectsLimit = (userId: string): Limit => ({ key: `extension-project:${userId}`, limit: 30, windowSeconds: 3600, reason: 'too_fast', message: 'Too many new projects. Try again later.' });
/** Discovery is also used by first-party consent, after validating each browser account. */
export async function projectsForSite(userId: string, origin: string) {
    const memberships = await listUserMemberships(userId);
    const projects = [];
    /** Where the popup may offer a new project for this site. A label only: creating checks the membership again. */
    const workspaces: { id: string; name: string; since: string }[] = [];
    for (const member of memberships) {
        const workspace = await getWorkspace(member.workspaceId);
        if (!workspace) continue;
        if (mayCreateProjects(member)) workspaces.push({ id: workspace.id, name: workspace.name, since: member.createdAt });
        for (const project of await listProjects(member.workspaceId)) {
            if (!projectOrigins(project).includes(origin)) continue;
            const actor = await memberActor(project, userId);
            if (actor?.kind !== 'member') continue;
            projects.push({ id: (await ensureProjectPublicId(project)).publicId, projectId: project.id, name: project.name, access: project.access,
                workspaceId: workspace.id, workspaceName: workspace.name });
        }
    }
    return {
        projects,
        // Oldest membership first, as the app lists a person's workspaces
        workspaces: workspaces.sort((a, b) => a.since.localeCompare(b.since)).map(({ id, name }) => ({ id, name })),
        canSetUp: memberships.some(m => m.role === 'admin')
    };
}
/**
 * A project for the site the extension is on, in a workspace the person chose: the app's own `createProject`, so
 * the same address and name rules apply and it starts invited-only. Checked for every request: the sign-in
 * approved creating projects (a session that approved reviewing alone keeps reviewing and gets no more) and the
 * stored admin membership (the list `projectsForSite` gave the popup grants nothing).
 *
 * `attempt` is the worker's random value for this submission. Its receipt (`reserveProjectCreation`) is written
 * before anything of the project, together with one unit of the hourly budget: the first request takes the unit,
 * and that request again, or several of it at once, find the receipt, take nothing and create or return the one
 * project. A project that was created and then deleted or transferred answers 410, never a second project.
 */
export async function createSiteProject(request: Request) {
    const session = await extensionSession(request);
    if (!hasExtensionCapability(session, 'create-projects'))
        throw apiErrors.forbidden('Sign in to the extension again to create projects.');
    const { origin, name, workspaceId, attempt } = await parseJsonBody(request, z.object({
        origin: originSchema, name: z.string().max(1000).default(''), workspaceId: z.string().min(1).max(128),
        attempt: z.string().regex(/^[A-Za-z0-9_-]{43}$/)
    }));
    const [user, member, workspace] = await Promise.all([getUser(session.userId), getMember(workspaceId, session.userId), getWorkspace(workspaceId)]);
    // One answer for a missing workspace, a removed member and a commenter: none says which workspaces exist
    if (!user || !workspace || !member || !mayCreateProjects(member)) throw apiErrors.forbidden('Only admins of this workspace can create projects.');
    const creator = { user, workspace }, input = { mode: 'website' as const, name, urls: [origin] };
    try {
        const receipt = await reserveProjectCreation(creator, input, attempt, siteProjectsLimit(user.id));
        const project = await createProject(creator, input, { receipt });
        return Response.json({ id: project.publicId, projectId: project.id, name: project.name, access: project.access,
            workspaceId: workspace.id, workspaceName: workspace.name }, { status: 201 });
    } catch (error) {
        // Final for this attempt: the worker forgets it, and the same form sent again is a new project
        if (error instanceof ProjectGoneError) throw new ApiError(410, 'not_found', error.message);
        // The app's form shows these messages; the popup shows them the same way
        if (error instanceof UserFacingError) throw apiErrors.invalidRequest(error.message);
        if (error instanceof z.ZodError) throw apiErrors.invalidRequest(error.issues[0]?.message ?? 'Check the project and try again.');
        throw error;
    }
}
export async function createScope(request: Request) {
    const session = await extensionSession(request);
    const { projectId, origin } = await parseJsonBody(request, z.object({ projectId: z.string().max(128), origin: originSchema }));
    const project = await findProject(projectId);
    if (!project || !projectOrigins(project).includes(origin) || !await memberActor(project, session.userId)) throw apiErrors.forbidden();
    return Response.json(scopeToken(session, project.id, origin));
}
export async function extensionReviewContext(request: Request): Promise<ReviewApiContext> {
    const scope = readScope(request);
    await loadExtensionSession(scope);
    const project = await findProject(scope.projectId);
    if (!project || !projectOrigins(project).includes(scope.origin)) throw apiErrors.forbidden('This project address is no longer available.');
    const actor = await memberActor(project, scope.userId);
    if (!actor) throw apiErrors.signInRequired();
    return { request, project, actor, siteOrigin: scope.origin };
}
