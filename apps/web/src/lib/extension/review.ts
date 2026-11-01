import { z } from 'zod';
import { projectOrigins, findProject, listProjects } from '../app/projects';
import { listUserMemberships } from '../app/workspaces';
import { ensureProjectPublicId } from '../app/projectPublicIds';
import { memberActor } from '../review/actor';
import { apiErrors, parseJsonBody } from '../comments/http';
import { extensionSession, loadExtensionSession, readScope, scopeToken } from './auth';
import type { ReviewApiContext } from '../review/http';

export const originSchema = z.string().max(512).refine(value => {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && url.origin === value; } catch { return false; }
}, 'An exact HTTP(S) origin is required.');
export async function matchingProjects(request: Request) {
    const session = await extensionSession(request);
    const origin = originSchema.safeParse(new URL(request.url).searchParams.get('origin'));
    if (!origin.success) throw apiErrors.invalidRequest('An exact HTTP(S) origin is required.');
    const memberships = await listUserMemberships(session.userId);
    const projects = [];
    for (const member of memberships) {
        for (const project of await listProjects(member.workspaceId)) {
            if (!projectOrigins(project).includes(origin.data)) continue;
            const actor = await memberActor(project, session.userId);
            if (actor?.kind !== 'member') continue;
            projects.push({ id: (await ensureProjectPublicId(project)).publicId, projectId: project.id, name: project.name, access: project.access });
        }
    }
    return Response.json({ projects, canSetUp: memberships.some(m => m.role === 'admin') });
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
