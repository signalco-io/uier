import { resolveToolbarFeatures } from '@uier/toolbar/toolbar-features';
import { setProjectCommentWorkflowStatus } from './comments';
import { feedbackStatusTargets } from '@uier/toolbar/verification';
import { workflowStatusIdSchema } from '../app/statusWorkflowSchema';
import { defaultFeedbackTypes, type FeedbackType } from '@uier/toolbar/feedback-types';
import { orderedStatuses } from '../app/statusWorkflow';
import { loadStatusWorkflow } from '../app/statusWorkflows';
import { loadFeedbackTypes } from '../app/feedbackTypes';
import { changeFixVerification } from './fixVerification';
import { fixVerificationSchema } from './fixVerificationSchema';
import { priorities } from '@uier/toolbar/triage';
import { idempotencyKeySchema } from '../comments/validation';
import { screenshotUrlMediaType } from '../screenshots/blobStore';
import { ensureProjectPublicId, type PublicProject } from '../app/projectPublicIds';
import { commentResponse } from './response';
import { configuredEnvironments, environmentOptions } from '../app/environments';
import { z } from 'zod';
import { userIdSchema } from '../app/validation';
import { keyedHash } from '../comments/environment';
import { pagePath, pageStatePolicy } from '@uier/toolbar/page-state';
import { apiErrors, parseJsonBody } from '../comments/http';
import { createCommentSchema, editThreadItemSchema, isValidId, reviewPathSchema, replySchema, rewriteRequestSchema, replaceScreenshotSchema } from '../comments/validation';
import { assertNotToolbarAnchor } from './toolbarAnchors';
import { isRewriteConfigured, suggestRewrites } from '../rewrite/suggest';
import { effectiveRewriteInstructions } from '../rewrite/settings';
import { getWorkspace } from '../app/workspaces';
import { getUser } from '../app/users';
import { setUserToolbarLanguage, toolbarLanguageInfo, userToolbarLanguageSchema } from '../app/toolbarLanguage';
import { MAX_COMMENT_BODY_BYTES, MAX_NEW_COMMENT_BODY_BYTES } from '../comments/limits';
import { screenshotResponse } from '../comments/screenshot';
import { newSourcePath } from '../comments/dto';
import { projectOrigins, projectReviewOrigin } from '../app/projects';
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
    setProjectCommentArchived,
    setProjectCommentStatus,
    setProjectCommentAssignee,
    setProjectCommentAssignees,
    setProjectCommentPriority,
    replaceProjectScreenshot
} from './comments';
import { eligibleParticipants, mentionsSchema } from './participants';
import type { ReviewApiContext } from './http';

import { assigneeIdsSchema, assignmentModeSchema } from './assignments';

// The review API (app/api/review/[projectId]/...): the toolbar of a project. Mirrors the public
// comments API (/api/comments) so the toolbar uses the same requests on another base URL.

function viewerDto(actor: ProjectActor) {
    return actor.kind === 'member'
        ? { kind: actor.kind, name: actor.name, isAdmin: actor.isAdmin }
        : { kind: actor.kind };
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

/** Workflow names, descriptions and defaults are member-only configuration. */
export async function getReviewStatuses({ project, actor }: ReviewApiContext) {
    if (actor.kind !== 'member') throw apiErrors.forbidden('Only project members can view status workflows.');
    const workflow = await loadStatusWorkflow(project);
    return Response.json({ ...workflow, statuses: orderedStatuses(workflow) });
}

/**
 * The project as the toolbar sees it: listed fields only, never its client, members or integrations.
 * Only the enabled feedback types (what the form offers): a disabled type's name and placeholder stay with
 * the project's admins, and saved threads show their own type snapshot.
 */
export function reviewProjectDto(project: PublicProject, canComment: boolean, feedbackTypes: readonly FeedbackType[] = defaultFeedbackTypes, isMember = false) {
    return { verificationEnabled: project.verificationEnabled === true, id: project.publicId, name: project.name, access: project.access, pageState: pageStatePolicy(project.pageState), ...(canComment ? { toolbarFeatures: resolveToolbarFeatures(project.toolbarFeatures, isMember), brief: project.brief, feedbackTypes: feedbackTypes.filter(type => type.enabled), environments: configuredEnvironments(project), environmentOptions: environmentOptions(project) } : {}) };
}

/** GET /api/review/<code>: the project, the reviewer and whether they can comment */
export async function getReviewInfo({ project, actor }: ReviewApiContext) {
    const publicProject = await ensureProjectPublicId(project);
    const { publicId } = publicProject;
    const canComment = project.access === 'guests' || (project.access === 'invited' && actor.kind === 'member');
    const [workspace, user] = await Promise.all([getWorkspace(project.workspaceId), actor.kind === 'member' ? getUser(actor.userId) : null]);
    return Response.json({
        project: reviewProjectDto(publicProject, canComment, canComment ? await loadFeedbackTypes(project) : [], actor.kind === 'member'),
        viewer: { ...viewerDto(actor), draftScope: keyedHash('draft-scope', actorAuthorId(actor) ?? 'anonymous') },
        canComment,
        // Also before anyone can comment: the notices are in it too. A member's own choice comes with it.
        language: toolbarLanguageInfo(workspace, project, actor.kind === 'member' ? user ?? {} : undefined),
        // Review links sign people in and come back to the page (the toolbar adds `url`)
        signInUrl: `${await (await import('../app/request')).appBaseUrl()}${KnownPageLinks.projectReview(publicId)}`
    });
}

/**
 * POST /api/review/<code>/language: a signed-in member's toolbar language (`null` goes back to the
 * project's), saved on their account like the app's Account → Toolbar language. Guests keep theirs in
 * their browser. Checked before the body is read; comments need not be on.
 */
export async function setReviewLanguage({ request, actor }: ReviewApiContext) {
    if (actor.kind !== 'member')
        throw apiErrors.signInRequired('Sign in to save your language. Without an account it stays in this browser.');
    const { language } = await parseJsonBody(request, z.object({ language: userToolbarLanguageSchema }).strict());
    return Response.json({ language: await setUserToolbarLanguage(actor.userId, language) });
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

// Query field names seen on the page, for the page state suggestions in settings; invalid names are dropped, not refused
const queryKeysSchema = z.array(z.string().max(64)).max(12).transform(keys => pageStatePolicy({ queryParameters: keys }).queryParameters);
const createSchema = createCommentSchema.safeExtend({ path: reviewPathSchema, authorName: guestNameSchema.optional(), mentions: mentionsSchema.optional(), queryKeys: queryKeysSchema.optional() });

export async function createReviewComment(context: ReviewApiContext) {
    const { request, project, actor, siteOrigin } = context;
    // A screenshot and a drawing make the body larger than other writes
    const input = await parseJsonBody(request, createSchema, MAX_NEW_COMMENT_BODY_BYTES);
    assertNotToolbarAnchor(siteOrigin, input.position);
    const authorName = writerName(actor, input.authorName);
    const origin = projectReviewOrigin(project, request, siteOrigin)!;
    const approved = pageStatePolicy(project.pageState).queryParameters;
    const queryKeys = input.queryKeys?.filter(key => !approved.includes(key));
    const path = pagePath(input.path, project.pageState);
    const sourcePath = newSourcePath(path, input.sourcePath, project.pageState);
    const comment = await createProjectComment(request, project, actor, { ...input, path, sourcePath, pageStateVersion: 1, authorName, origin, queryKeys });
    return await commentResponse(context, comment, 201);
}

const replyInputSchema = replySchema.extend({ authorName: guestNameSchema.optional(), mentions: mentionsSchema.optional() });

export async function replyToReviewComment(context: ReviewApiContext, { id }: { id: string }) {
    const { request, project, actor } = context;
    const input = await parseJsonBody(request, replyInputSchema, MAX_COMMENT_BODY_BYTES);
    const authorName = writerName(actor, input.authorName);
    const comment = await replyToProjectComment(request, project, actor, commentId(id), { text: input.text, authorName, mentions: input.mentions, screenshot: input.screenshot, idempotencyKey: input.idempotencyKey });
    return await commentResponse(context, comment, 201);
}

/** Share the legacy status contract and the additive archive operation with the public API. */
const updateSchema = z.object({
    statusId: workflowStatusIdSchema.optional(), archived: z.boolean().optional(),
    resolved: z.boolean().optional(), status: z.enum(feedbackStatusTargets).optional()
}).strict().refine(input => [input.statusId, input.archived, input.resolved, input.status].filter(value => value !== undefined).length === 1, 'Send exactly one of statusId, archived, resolved or status.');

export async function updateReviewComment(context: ReviewApiContext, { id }: { id: string }) {
    const { request, project, actor } = context;
    const input = await parseJsonBody(request, updateSchema);
    assertWriter(actor);
    return await commentResponse(context, input.statusId !== undefined
        ? await setProjectCommentWorkflowStatus(project, actor, commentId(id), input.statusId)
        : input.archived !== undefined
        ? await setProjectCommentArchived(project, actor, commentId(id), input.archived)
        : input.status !== undefined
        ? await setProjectCommentStatus(project, actor, commentId(id), input.status)
        : await setProjectCommentResolved(project, actor, commentId(id), input.resolved!));
}

/** POST /api/review/<code>/rewrite: rewrite suggestions for selected text, for those who can comment */
export async function suggestReviewRewrites({ request, project, actor }: ReviewApiContext) {
    assertWriter(actor);
    const input = await parseJsonBody(request, rewriteRequestSchema);
    // Before the limits count the request
    if (!isRewriteConfigured())
        throw apiErrors.unavailable('Rewrite suggestions are not available here.');

    const guidance = effectiveRewriteInstructions(await getWorkspace(project.workspaceId), project);
    await enforceProjectRewriteLimits(request, project, actor);
    return Response.json({ suggestions: await suggestRewrites(input.text, input.instruction, guidance) });
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
export async function getReviewScreenshot({ project, actor, request }: ReviewApiContext, { id, itemId }: { id: string; itemId?: string }) {
    if (itemId !== undefined && !isValidId(itemId)) throw apiErrors.notFound();
    return screenshotResponse(await getProjectScreenshot(project, actor, commentId(id), itemId), request.headers.get('accept') === screenshotUrlMediaType ? 'url' : 'bytes');
}

/** Participant lookup is member-only and uses the same visibility rule as a thread read. */
export async function listReviewParticipants(context: ReviewApiContext) {
    const id = new URL(context.request.url).searchParams.get('commentId');
    const comment = id ? await getProjectComment(context.project, context.actor, commentId(id)) : undefined;
    if (id && !comment) throw apiErrors.notFound();
    return Response.json(await eligibleParticipants(context.project, context.actor, comment ?? undefined));
}

export async function assignReviewComment(context: ReviewApiContext, { id }: { id: string }) {
    const input = await parseJsonBody(context.request, z.object({ assigneeId: userIdSchema.nullable().optional(), assigneeIds: assigneeIdsSchema.optional(), mode: assignmentModeSchema.optional() }).strict()
        .refine(input => (input.assigneeId !== undefined) !== (input.assigneeIds !== undefined) && !(input.assigneeId !== undefined && input.mode !== undefined)));
    return await commentResponse(context, input.assigneeIds !== undefined
        ? await setProjectCommentAssignees(context.project, context.actor, commentId(id), input.assigneeIds, input.mode)
        : await setProjectCommentAssignee(context.project, context.actor, commentId(id), input.assigneeId!));
}

export async function replaceReviewScreenshot(context: ReviewApiContext, { id }: { id: string }) {
    const { actor, project } = context;
    assertWriter(actor);
    const input = await parseJsonBody(context.request, replaceScreenshotSchema, MAX_COMMENT_BODY_BYTES);
    const comment = await replaceProjectScreenshot(project, actor, commentId(id), input);
    return commentResponse(context, comment);
}

export { listReviewComments, readReviewComment, unreadReviewComment } from './readRoutes';

export async function prioritizeReviewComment(context: ReviewApiContext, { id }: { id: string }) {
    const { priority, idempotencyKey } = await parseJsonBody(context.request, z.object({ priority: z.enum(priorities), idempotencyKey: idempotencyKeySchema }));
    return commentResponse(context, await setProjectCommentPriority(context.project, context.actor, commentId(id), priority, idempotencyKey));
}

export async function verifyReviewFix(context: ReviewApiContext, { id }: { id: string }) {
    const input = await parseJsonBody(context.request, fixVerificationSchema);
    return commentResponse(context, await changeFixVerification(context.project, context.actor, commentId(id), input));
}
