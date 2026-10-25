import { getReadSequence } from '../comments/readState';
import { threadNotificationStates } from '../notifications/preferences';
import { z } from 'zod';
import { keyedHash } from '../comments/environment';
import { pagePath, pageStatePolicy } from '@uier/toolbar/page-state';
import { apiErrors, parseJsonBody } from '../comments/http';
import { createCommentSchema, editThreadItemSchema, isValidId, reviewPathSchema, replySchema, rewriteRequestSchema, replaceScreenshotSchema } from '../comments/validation';
import { isRewriteConfigured, suggestRewrites } from '../rewrite/suggest';
import { MAX_COMMENT_BODY_BYTES } from '../comments/limits';
import { screenshotResponse } from '../comments/screenshot';
import { projectOrigins } from '../app/projects';
import { appBaseUrl } from '../app/request';
import { KnownPageLinks } from '../../knownPages';
import { actorAuthorId, assertWriter, exchangeReviewCode, guestNameSchema, type ProjectActor } from './actor';
import {
    createProjectComment,
    deleteProjectCommentItem,
    editProjectCommentItem,
    enforceProjectRewriteLimits,
    getProjectComment,
    getProjectScreenshot,
    replyToProjectComment,
    setProjectCommentResolved,
    setProjectCommentAssignee,
    replaceProjectScreenshot
} from './comments';
import { authorNames, participantNames, toReviewCommentDto } from './dto';
import { eligibleParticipants, mentionsSchema } from './participants';
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
    const actorId = actorAuthorId(context.actor);
    const [names, participants, readSequence] = await Promise.all([authorNames([comment]), participantNames(context.project), actorId ? getReadSequence(comment.domain, actorId, comment.id) : 0]);
    const dto = toReviewCommentDto(comment, context.actor, names, projectOrigins(context.project), readSequence, participants);
    if (!dto)
        throw new Error(`Comment ${comment.id} can't be represented`);
    const notifications = (await threadNotificationStates(context.project, context.actor, [comment])).get(comment.id);
    return Response.json({ ...dto, notifications }, { status });
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
        project: { id: project.id, name: project.name, access: project.access, pageState: pageStatePolicy(project.pageState) },
        viewer: { ...viewerDto(actor), draftScope: keyedHash('draft-scope', actorAuthorId(actor) ?? 'anonymous') },
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

const createSchema = createCommentSchema.safeExtend({ path: reviewPathSchema, authorName: guestNameSchema.optional(), mentions: mentionsSchema.optional() });

export async function createReviewComment(context: ReviewApiContext) {
    const { request, project, actor, siteOrigin } = context;
    // A screenshot makes the body larger than other writes
    const input = await parseJsonBody(request, createSchema, MAX_COMMENT_BODY_BYTES);
    const authorName = writerName(actor, input.authorName);
    const origin = siteOrigin ?? projectOrigins(project)[0]!;
    const comment = await createProjectComment(request, project, actor, { ...input, path: pagePath(input.path, project.pageState), pageStateVersion: 1, authorName, origin });
    return await commentResponse(context, comment, 201);
}

const replyInputSchema = replySchema.extend({ authorName: guestNameSchema.optional(), mentions: mentionsSchema.optional() });

export async function replyToReviewComment(context: ReviewApiContext, { id }: { id: string }) {
    const { request, project, actor } = context;
    const input = await parseJsonBody(request, replyInputSchema);
    const authorName = writerName(actor, input.authorName);
    const comment = await replyToProjectComment(request, project, actor, commentId(id), { text: input.text, authorName, mentions: input.mentions, idempotencyKey: input.idempotencyKey });
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

/** PATCH of one message, including the first item, with a stale-edit check. */
export async function editReviewCommentItem(context: ReviewApiContext, { id, itemId }: { id: string; itemId: string }) {
    assertWriter(context.actor);
    const input = await parseJsonBody(context.request, editThreadItemSchema.extend({ mentions: mentionsSchema.optional() }));
    if (!isValidId(itemId)) throw apiErrors.notFound();
    return await commentResponse(context, await editProjectCommentItem(context.project, context.actor, commentId(id), itemId, input));
}

/** GET /api/review/<code>/comments/<id>/screenshot: the screenshot of a comment the reviewer can see */
export async function getReviewScreenshot({ project, actor }: ReviewApiContext, { id }: { id: string }) {
    return screenshotResponse(await getProjectScreenshot(project, actor, commentId(id)));
}

/** Participant lookup is member-only and uses the same visibility rule as a thread read. */
export async function listReviewParticipants(context: ReviewApiContext) {
    const id = new URL(context.request.url).searchParams.get('commentId');
    const comment = id ? await getProjectComment(context.project, context.actor, commentId(id)) : undefined;
    if (id && !comment) throw apiErrors.notFound();
    return Response.json(await eligibleParticipants(context.project, context.actor, comment ?? undefined));
}

export async function assignReviewComment(context: ReviewApiContext, { id }: { id: string }) {
    const { assigneeId } = await parseJsonBody(context.request, z.object({ assigneeId: z.string().max(128).nullable() }));
    return await commentResponse(context, await setProjectCommentAssignee(context.project, context.actor, commentId(id), assigneeId));
}

export async function replaceReviewScreenshot(context: ReviewApiContext, { id }: { id: string }) {
    const { actor, project } = context;
    assertWriter(actor);
    const input = await parseJsonBody(context.request, replaceScreenshotSchema, MAX_COMMENT_BODY_BYTES);
    const comment = await replaceProjectScreenshot(project, actor, commentId(id), input);
    return commentResponse(context, comment);
}

export { listReviewComments, readReviewComment } from './readRoutes';
