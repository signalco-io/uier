import { environmentSelection, environmentFilter } from '../app/environments';
import { matchesOrigin } from '../repo/originFilter';
import { z } from 'zod';
import { pagePath } from '@uier/toolbar/page-state';
import { apiErrors, parseJsonBody } from '../comments/http';
import { loadReadSequences, markThreadRead, projectActivity, unreadComments } from '../comments/readState';
import { withinListResponseSize } from '../comments/dto';
import { MAX_LIST_COMMENTS } from '../comments/limits';
import { isValidId, reviewPathSchema } from '../comments/validation';
import { projectOrigins, projectReviewOrigin } from '../app/projects';
import { actorAuthorId, assertWriter } from './actor';
import { canSeeComment, getProjectComment, listProjectComments } from './comments';
import { authorNames, participantNames, toReviewCommentDto } from './dto';
import type { ReviewApiContext } from './http';
import { threadNotificationStates } from '../notifications/preferences';
import { bulkReadSchema, MAX_BULK_READ_BYTES } from '../comments/bulkRead';
import { markProjectThreadsRead } from './bulkRead';

const listQuerySchema = z.object({ path: reviewPathSchema });

/** `?path=/x`: the comments of the page; `?scope=site`: of every page (the toolbar's inbox) */
export async function listReviewComments({ request, project, actor, siteOrigin }: ReviewApiContext) {
    const params = new URL(request.url).searchParams;
    let path: string | undefined;
    if (params.get('scope') !== 'site') {
        const query = listQuerySchema.safeParse({ path: params.get('path') ?? '' });
        if (!query.success)
            throw apiErrors.invalidRequest('"path" is required and must start with "/".');
        path = pagePath(query.data.path, project.pageState);
    }

    const filter = environmentFilter(project, environmentSelection(project, params.get('environment'), projectReviewOrigin(project, request, siteOrigin)));
    const visible = (comment: import('../db/schema').DbCommentActivity) => canSeeComment(comment, actor) && matchesOrigin(comment.origin, filter);
    const comments = (params.get('unread') === 'true' && path === undefined
        ? await unreadComments(`project:${project.id}`, actorAuthorId(actor), visible)
        : await listProjectComments(project, actor, path, filter)).slice(0, MAX_LIST_COMMENTS);
    const [names, reads, participants, notifications] = await Promise.all([
        authorNames(comments), loadReadSequences(`project:${project.id}`, actorAuthorId(actor)), participantNames(project), threadNotificationStates(project, actor, comments)
    ]);
    // As many as fit into the comments API's response size
    return Response.json(withinListResponseSize(comments
        .map(comment => {
            const dto = toReviewCommentDto(comment, actor, names, projectOrigins(project), reads.get(comment.id), participants, project);
            return dto ? { ...dto, notifications: notifications.get(comment.id) } : null;
        })
        .filter(Boolean)));
}

const readSchema = z.object({ sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) });

export async function readReviewComments({ request, project, actor }: ReviewApiContext) {
    assertWriter(actor);
    const input = await parseJsonBody(request, bulkReadSchema, MAX_BULK_READ_BYTES);
    return Response.json(await markProjectThreadsRead(project, actor, input));
}

/** Acknowledge only the activity actually rendered, after the same project/private checks as reads. */
export async function readReviewComment({ request, project, actor }: ReviewApiContext, { id }: { id: string }) {
    assertWriter(actor);
    if (!isValidId(id)) throw apiErrors.notFound();
    const { sequence } = await parseJsonBody(request, readSchema);
    const comment = await getProjectComment(project, actor, id);
    if (!comment) throw apiErrors.notFound();
    return Response.json(await markThreadRead(comment, actorAuthorId(actor)!, sequence));
}

export async function reviewActivitySummary({ project, actor, request, siteOrigin }: ReviewApiContext) {
    const filter = environmentFilter(project, environmentSelection(project, new URL(request.url).searchParams.get('environment'), projectReviewOrigin(project, request, siteOrigin)));
    const { summary } = await projectActivity(`project:${project.id}`, actorAuthorId(actor), comment => canSeeComment(comment, actor) && matchesOrigin(comment.origin, filter));
    return Response.json(summary);
}
