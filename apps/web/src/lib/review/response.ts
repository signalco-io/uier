import { getReadSequence } from '../comments/readState';
import { threadNotificationStates } from '../notifications/preferences';
import { projectOrigins } from '../app/projects';
import { actorAuthorId } from './actor';
import { authorNames, participantNames, toReviewCommentDto } from './dto';
import type { ReviewApiContext } from './http';
import type { DbComment } from '../db/schema';

export async function commentResponse(context: ReviewApiContext, comment: DbComment | null, status = 200) {
    if (!comment)
        return new Response(null, { status: 204 });
    const actorId = actorAuthorId(context.actor);
    const [names, participants, readSequence] = await Promise.all([authorNames([comment]), participantNames(context.project), actorId ? getReadSequence(comment.domain, actorId, comment.id) : 0]);
    const dto = toReviewCommentDto(comment, context.actor, names, projectOrigins(context.project), readSequence, participants, context.project);
    if (!dto)
        throw new Error(`Comment ${comment.id} can't be represented`);
    const notifications = (await threadNotificationStates(context.project, context.actor, [comment])).get(comment.id);
    return Response.json({ ...dto, notifications }, { status });
}
