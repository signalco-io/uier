import { requestSessionUser } from '../../../../src/lib/app/sessionIdentity';
import { findProject } from '../../../../src/lib/app/projects';
import { memberActor } from '../../../../src/lib/review/actor';
import { projectPartition } from '../../../../src/lib/review/comments';
import { issueRealtimeTicket } from '../../../../src/lib/realtime/tickets';
import { apiErrors, errorResponse } from '../../../../src/lib/comments/http';

export async function GET(request: Request) {
    try {
        const user = await requestSessionUser(request);
        if (!user) throw apiErrors.signInRequired();
        const project = await findProject(new URL(request.url).searchParams.get('projectId') ?? '');
        const actor = project && await memberActor(project, user.id);
        if (!project || !actor) throw apiErrors.notFound();
        return Response.json(issueRealtimeTicket(request, projectPartition(project.id), actor, 'app', project), { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        const response = errorResponse(error);
        response.headers.set('Cache-Control', 'no-store');
        return response;
    }
}
