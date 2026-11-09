import { commentsApiHandler, type CommentsApiContext } from '../../../../src/lib/comments/http';
import { issueRealtimeTicket } from '../../../../src/lib/realtime/tickets';
import type { ProjectActor } from '../../../../src/lib/review/actor';

const actorOf = (context: CommentsApiContext): ProjectActor =>
    context.actor ?? (context.visitor.authorId ? { kind: 'guest', visitorId: context.visitor.authorId } : { kind: 'anonymous' });

// A signed-in account follows its own threads and the guests' public ones
export const GET = commentsApiHandler(async context => Response.json(issueRealtimeTicket(context.request, context.domain, actorOf(context), 'showcase', context.project,
    context.publicFeedback ? { domain: context.publicFeedback.domain, actor: actorOf(context.publicFeedback), project: context.publicFeedback.project } : undefined)));
