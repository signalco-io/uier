import { requestSessionUser } from '@/src/lib/app/sessionIdentity';
import { findProject } from '@/src/lib/app/projects';
import { projectIdSchema } from '@/src/lib/app/validation';
import { isValidId } from '@/src/lib/comments/validation';
import { apiErrors, errorResponse } from '@/src/lib/comments/http';
import { loadThreadPullRequests } from '@/src/lib/integrations/pullRequests';

/** App-session-only reads, outside the server action queue so a slow provider never delays a reply. */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string; id: string }> }) {
    let response: Response;
    try {
        const site = request.headers.get('sec-fetch-site');
        if (site && site !== 'same-origin' && site !== 'none') throw apiErrors.forbidden('Cross-site requests are not allowed.');
        const user = await requestSessionUser(request);
        if (!user) throw apiErrors.signInRequired();
        const { projectId, id } = await params;
        if (!projectIdSchema.safeParse(projectId).success || !isValidId(id)) throw apiErrors.invalidRequest('Choose a valid thread.');
        const project = await findProject(projectId);
        if (!project) throw apiErrors.notFound();
        response = Response.json(await loadThreadPullRequests(project.workspaceId, project.id, user.id, id));
    } catch (error) { response = errorResponse(error); }
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Vary', 'Cookie');
    return response;
}
