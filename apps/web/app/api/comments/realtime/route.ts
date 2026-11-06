import { commentsApiHandler } from '../../../../src/lib/comments/http';
import { issueRealtimeTicket } from '../../../../src/lib/realtime/tickets';

export const GET = commentsApiHandler(async context => Response.json(issueRealtimeTicket(context.request, context.domain,
    context.actor ?? (context.visitor.authorId ? { kind: 'guest', visitorId: context.visitor.authorId } : { kind: 'anonymous' }), 'showcase', context.project)));
