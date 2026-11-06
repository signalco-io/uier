import { reviewApiHandler, reviewPreflight } from '../../../../../src/lib/review/http';
import { projectPartition } from '../../../../../src/lib/review/comments';
import { issueRealtimeTicket } from '../../../../../src/lib/realtime/tickets';

export const GET = reviewApiHandler(async ({ request, project, actor }) =>
    Response.json(issueRealtimeTicket(request, projectPartition(project.id), actor, 'review', project)));
export const OPTIONS = reviewPreflight('GET');
