import { z } from 'zod';
import { apiErrors, parseJsonBody } from '../comments/http';
import { createCommentSchema, isValidId, pathSchema, replySchema, rewriteRequestSchema } from '../comments/validation';
import { isRewriteConfigured, suggestRewrites } from '../rewrite/suggest';
import { MAX_COMMENT_BODY_BYTES, MAX_LIST_COMMENTS } from '../comments/limits';
import { screenshotResponse } from '../comments/screenshot';
import { withinListResponseSize } from '../comments/dto';
import { projectOrigins } from '../app/projects';
import { appBaseUrl } from '../app/request';
import { KnownPageLinks } from '../../knownPages';
import { assertWriter, exchangeReviewCode, guestNameSchema, type ProjectActor } from './actor';
import {
    createProjectComment,
    deleteProjectCommentItem,
    enforceProjectRewriteLimits,
    getProjectComment,
    getProjectScreenshot,
    listProjectComments,
    replyToProjectComment,
    setProjectCommentResolved
} from './comments';
import { authorNames, toReviewCommentDto } from './dto';
import type { ReviewApiContext } from './http';
import type { DbComment } from '../db/schema';

// The review API (app/api/review/[projectId]/...): the toolbar of a project. Mirrors the public
// comments API (/api/comments) so the toolbar uses the same requests on another base URL.

function viewerDto(actor: ProjectActor) {
    return actor.kind === 'member'
        ? { kind: actor.kind, name: actor.name, isAdmin: actor.isAdmin }
        : { kind: actor.kind };
}

async function commentResponse(context: ReviewApiContext, comment: DbComment | null, status = 200) {
    if (!comment)
        return new Response(null, { status: 204 });
    const dto = toReviewCommentDto(comment, context.actor, await authorNames([comment]));
    if (!dto)
        throw new Error(`Comment ${comment.id} can't be represented`);
    return Response.json(dto, { status });
}

function commentId(id: string) {
    if (!isValidId(id))
        throw apiErrors.notFound();
    return id;
}

/** Guests write under the name they gave; members under their account name */
function writerName(actor: ProjectActor, authorName: string | undefined) {
    assertWriter(actor);
    if (actor.kind === 'guest' && !authorName)
        throw apiErrors.invalidRequest('"authorName" must not be empty.');
    return authorName;
}

/** GET /api/review/<code>: the project, the reviewer and whether they can comment */
export async function getReviewInfo({ project, actor }: ReviewApiContext) {
    const canComment = project.access === 'guests' || (project.access === 'invited' && actor.kind === 'member');
    return Response.json({
        project: { id: project.id, name: project.name, access: project.access },
        viewer: viewerDto(actor),
        canComment,
        // Review links sign people in and come back to the page (the toolbar adds `url`)
        signInUrl: `${await appBaseUrl()}${KnownPageLinks.projectReview(project.id)}`
    });
}

const sessionSchema = z.object({ code: z.string().max(128) });

/** POST /api/review/<code>/session: exchanges the review link's single-use code for a review token */
export async function createReviewSession({ request, project }: ReviewApiContext) {
    const { code } = await parseJsonBody(request, sessionSchema);
    const session = await exchangeReviewCode(project, code);
    if (!session)
        throw apiErrors.forbidden('This review link has expired. Open it again from uier.');
    return Response.json({ token: session.token, viewer: viewerDto(session.actor) }, { status: 201 });
}

const listQuerySchema = z.object({ path: pathSchema });

/** `?path=/x`: the comments of the page; `?scope=site`: of every page (the toolbar's inbox) */
export async function listReviewComments({ request, project, actor }: ReviewApiContext) {
    const params = new URL(request.url).searchParams;
    let path: string | undefined;
    if (params.get('scope') !== 'site') {
        const query = listQuerySchema.safeParse({ path: params.get('path') ?? '' });
        if (!query.success)
            throw apiErrors.invalidRequest('"path" is required and must start with "/".');
        path = query.data.path;
    }

    const comments = (await listProjectComments(project, actor, path)).slice(0, MAX_LIST_COMMENTS);
    const names = await authorNames(comments);
    // As many as fit into the comments API's response size
    return Response.json(withinListResponseSize(comments
        .map(comment => toReviewCommentDto(comment, actor, names))
        .filter(Boolean)));
}

const createSchema = createCommentSchema.extend({ authorName: guestNameSchema.optional() });

export async function createReviewComment(context: ReviewApiContext) {
    const { request, project, actor, siteOrigin } = context;
    // A screenshot makes the body larger than other writes
    const input = await parseJsonBody(request, createSchema, MAX_COMMENT_BODY_BYTES);
    const authorName = writerName(actor, input.authorName);
    const origin = siteOrigin ?? projectOrigins(project)[0]!;
    const comment = await createProjectComment(request, project, actor, { ...input, authorName, origin });
    return await commentResponse(context, comment, 201);
}

const replyInputSchema = replySchema.extend({ authorName: guestNameSchema.optional() });

export async function replyToReviewComment(context: ReviewApiContext, { id }: { id: string }) {
    const { request, project, actor } = context;
    const input = await parseJsonBody(request, replyInputSchema);
    const authorName = writerName(actor, input.authorName);
    const comment = await replyToProjectComment(request, project, actor, commentId(id), { text: input.text, authorName });
    return await commentResponse(context, comment, 201);
}

const updateSchema = z.object({ resolved: z.boolean() });

export async function updateReviewComment(context: ReviewApiContext, { id }: { id: string }) {
    const { request, project, actor } = context;
    const { resolved } = await parseJsonBody(request, updateSchema);
    assertWriter(actor);
    return await commentResponse(context, await setProjectCommentResolved(project, actor, commentId(id), resolved));
}

/** POST /api/review/<code>/rewrite: rewrite suggestions for selected text, for those who can comment */
export async function suggestReviewRewrites({ request, project, actor }: ReviewApiContext) {
    assertWriter(actor);
    const input = await parseJsonBody(request, rewriteRequestSchema);
    // Before the limits count the request
    if (!isRewriteConfigured())
        throw apiErrors.unavailable('Rewrite suggestions are not available here.');

    await enforceProjectRewriteLimits(request, project, actor);
    return Response.json({ suggestions: await suggestRewrites(input.text, input.instruction) });
}

/** DELETE of the comment (its first item) or of one reply */
export async function deleteReviewCommentItem(context: ReviewApiContext, { id, itemId }: { id: string; itemId?: string }) {
    const { project, actor } = context;
    assertWriter(actor);
    const comment = await getProjectComment(project, actor, commentId(id));
    if (!comment)
        throw apiErrors.notFound();

    const firstItemId = comment.thread.items[0]?.id;
    const target = itemId ?? firstItemId;
    if (!target || (itemId !== undefined && !isValidId(itemId)))
        throw apiErrors.notFound('Reply not found.');
    return await commentResponse(context, await deleteProjectCommentItem(project, actor, comment.id, target));
}

/** GET /api/review/<code>/comments/<id>/screenshot: the screenshot of a comment the reviewer can see */
export async function getReviewScreenshot({ project, actor }: ReviewApiContext, { id }: { id: string }) {
    return screenshotResponse(await getProjectScreenshot(project, actor, commentId(id)));
}
