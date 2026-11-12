import { archiveFilter } from '../repo/archiveFilter';
import { environmentSelection, environmentFilter } from '../app/environments';
import { matchesOrigin } from '../repo/originFilter';
import { z } from 'zod';
import { pagePath } from '@uier/toolbar/page-state';
import { apiErrors, parseJsonBody } from '../comments/http';
import { loadReadSequences, markThreadRead, markThreadUnread, projectActivity, unreadComments } from '../comments/readState';
import { withinListResponseSize } from '../comments/dto';
import { MAX_LIST_COMMENTS } from '../comments/limits';
import { listPage } from '../comments/listPage';
import { commentPageCursor, formatCommentPageCursor } from '../repo/commentPage';
import { isValidId, reviewPathSchema } from '../comments/validation';
import { projectOrigins, projectReviewOrigin } from '../app/projects';
import { actorAuthorId, assertWriter } from './actor';
import { canSeeComment, getProjectComment, listProjectComments, listProjectCommentsPage } from './comments';
import { authorNames, participantNames, toReviewCommentDto } from './dto';
import type { ReviewApiContext } from './http';
import { threadNotificationStates } from '../notifications/preferences';
import { bulkReadSchema, MAX_BULK_READ_BYTES } from '../comments/bulkRead';
import { markProjectThreadsRead } from './bulkRead';
import { loadIntegrationLinks } from '../integrations/links';

const listQuerySchema = z.object({ path: reviewPathSchema });

/**
 * `?path=/x`: the comments of the page; `?scope=site`: of every page (the toolbar's inbox), newest first.
 * With `?limit=` or `?before=` (`listPage.ts`) a list is one keyset page, `{ comments, next }`: `next` is the
 * `before` of the following page, or `null` at the end. It is also set when the response was cut at its size limit,
 * so a short page never means the end. Without them, the plain array as before; the unread list is one page.
 */
export async function listReviewComments({ request, project, actor, siteOrigin }: ReviewApiContext) {
    const params = new URL(request.url).searchParams;
    let path: string | undefined;
    if (params.get('scope') !== 'site') {
        const query = listQuerySchema.safeParse({ path: params.get('path') ?? '' });
        if (!query.success)
            throw apiErrors.invalidRequest('"path" is required and must start with "/".');
        path = pagePath(query.data.path, project.pageState);
    }
    const unread = params.get('unread') === 'true' && path === undefined;
    const page = listPage(params);
    if (page && unread)
        throw apiErrors.invalidRequest('The unread list is one page: "limit" and "before" are not supported with it.');

    const archive = archiveFilter(params.get('archive'));
    const filter = environmentFilter(project, environmentSelection(project, params.get('environment'), projectReviewOrigin(project, request, siteOrigin)));
    const visible = (comment: import('../db/schema').DbCommentActivity) => canSeeComment(comment, actor) && matchesOrigin(comment.origin, filter);
    const paged = page ? await listProjectCommentsPage(project, actor, page, path, filter, archive) : undefined;
    const comments = paged
        ? paged.comments
        : unread
        ? (await unreadComments(`project:${project.id}`, actorAuthorId(actor), visible, archive)).slice(0, MAX_LIST_COMMENTS)
        : (await listProjectComments(project, actor, path, filter, undefined, undefined, archive)).slice(0, MAX_LIST_COMMENTS);
    const [names, reads, participants, notifications, links] = await Promise.all([
        authorNames(comments), loadReadSequences(`project:${project.id}`, actorAuthorId(actor)), participantNames(project), threadNotificationStates(project, actor, comments),
        loadIntegrationLinks(project, actor, comments)
    ]);
    const listed = comments.flatMap(comment => {
        const dto = toReviewCommentDto(comment, actor, names, projectOrigins(project), reads.get(comment.id), participants, project);
        return dto ? [{ comment, dto: { ...dto, notifications: notifications.get(comment.id), ...(links.has(comment.id) ? { integrationLinks: links.get(comment.id) } : {}) } }] : [];
    });
    // As many as fit into the comments API's response size
    const fitting = withinListResponseSize(listed.map(item => item.dto));
    if (!paged || !page) return Response.json(fitting);

    // Cut at the size limit: the next page starts after the last one sent (after the first when none fit, so a
    // thread too large to send never stops paging). Otherwise after the last record storage read, when it was full.
    const cut = fitting.length < listed.length;
    const last = cut ? listed[Math.max(0, fitting.length - 1)]!.comment : paged.stored.length >= page.limit ? paged.stored.at(-1) : undefined;
    return Response.json({ comments: fitting, next: last ? formatCommentPageCursor(commentPageCursor(last)) : null });
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

/** Mark as unread, after the same project/private checks as reads */
export async function unreadReviewComment({ project, actor }: ReviewApiContext, { id }: { id: string }) {
    assertWriter(actor);
    if (!isValidId(id)) throw apiErrors.notFound();
    const comment = await getProjectComment(project, actor, id);
    if (!comment) throw apiErrors.notFound();
    return Response.json(await markThreadUnread(comment, actorAuthorId(actor)!));
}

export async function reviewActivitySummary({ project, actor, request, siteOrigin }: ReviewApiContext) {
    const filter = environmentFilter(project, environmentSelection(project, new URL(request.url).searchParams.get('environment'), projectReviewOrigin(project, request, siteOrigin)));
    const { summary } = await projectActivity(`project:${project.id}`, actorAuthorId(actor), comment => canSeeComment(comment, actor) && matchesOrigin(comment.origin, filter), 'exclude', project.verificationEnabled === true);
    return Response.json(summary);
}
