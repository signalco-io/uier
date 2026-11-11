'use server';

import { setProjectCommentPullRequest } from '../../../lib/review/pullRequests';
import { pullRequestCommentActionSchema, reactionCommentActionSchema } from './actionSchemas';
import { setProjectCommentReaction } from '../../../lib/review/reactions';
import { z as verificationZ } from 'zod';
import { changeFixVerification } from '../../../lib/review/fixVerification';
import { fixVerificationSchema } from '../../../lib/review/fixVerificationSchema';

import { triageProjectComments } from '../../../lib/review/bulkTriage';
import { bulkTriageSchema } from '../../../lib/review/bulkTriageSchema';
import { projectIdSchema } from '../../../lib/app/validation';
import { agentCommentActionSchema, assignCommentsPeopleActionSchema, boardArchiveActionSchema, boardSortActionSchema, priorityCommentActionSchema } from './actionSchemas';
import { saveProjectBoardArchive, saveProjectBoardSort } from '../../../lib/app/projectBoard';
import type { BoardColumn, BoardSort } from '../../../lib/app/boardSort';
import { setProjectCommentAgent } from '../../../lib/review/assigneeAgent';
import type { AssigneeAgentInput } from '../../../lib/review/assigneeAgentModel';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import type { z } from 'zod';
import { screenshotSchema } from '../../../lib/comments/validation';
import { parseActionInput } from '../../../lib/app/validation';
import { actionResult, UserFacingError, type ActionState } from '../../../lib/app/actionResult';
import { appContextOrThrow } from '../../../lib/app/context';
import { getVisibleProject } from '../../../lib/app/projects';
import { appActor } from '../../../lib/app/projectComments';
import { ApiError } from '../../../lib/comments/http';
import {
    getProjectComment,
    deleteProjectCommentItem,
    editProjectCommentItem,
    editProjectCommentText,
    removeProjectComment,
    replyToProjectComment,
    setProjectCommentAssignee,
    setProjectCommentAssignees,
    setProjectCommentArchived,
    setProjectCommentPrivate,
    setProjectCommentStatus,
    setProjectCommentPriority,
    setProjectCommentTitle
} from '../../../lib/review/comments';
import { markThreadRead, markThreadUnread } from '../../../lib/comments/readState';
import { actorAuthorId } from '../../../lib/review/actor';
import { apiErrors } from '../../../lib/comments/http';
import { KnownPageLinks } from '../../../knownPages';
import { appBaseUrl } from '../../../lib/app/request';
import { projectFeedbackExport } from '../../../lib/review/feedbackContext';
import { markProjectThreadsRead } from '../../../lib/review/bulkRead';
import type { ReadThreadInput } from '../../../lib/comments/bulkRead';
import { createCommentAuthorFilter } from '../../../lib/app/commentAuthors';
import { assertCanUseComments } from '../../../lib/review/actor';
import { eligibleParticipants } from '../../../lib/review/participants';
import { assignCommentActionSchema, commentActionSchema, deleteReplyActionSchema, editCommentActionSchema, editReplyActionSchema,
    filterAuthorActionSchema, archiveCommentActionSchema, privateCommentActionSchema, readCommentActionSchema, readCommentsActionSchema,
    replyCommentActionSchema, statusCommentActionSchema, titleCommentActionSchema } from './actionSchemas';

/** Session/workspace authority and request metadata come only from the server request. */
export async function replyCommentAction(input: import('zod').infer<typeof replyCommentActionSchema>) {
    return commentAction(replyCommentActionSchema, input, async ({ project, actor }, parsed) => {
        assertCanUseComments(project, actor);
        const request = new Request(`${await appBaseUrl()}/app/projects/${project.id}`, { headers: await headers() });
        const screenshot = parsed.screenshot ? await screenshotSchema.parseAsync(parsed.screenshot) : undefined;
        await replyToProjectComment(request, project, actor, parsed.commentId, { ...parsed, screenshot });
    });
}

/**
 * Adds or removes the member's own reaction to one message: who may reply may react (comments on, the thread
 * visible), checked again by the service on every write attempt, with the member's reaction limit.
 */
export async function reactToCommentAction(projectId: string, commentId: string, itemId: string, emoji: import('@uier/toolbar/reactions').ReactionId, reacted: boolean) {
    return commentAction(reactionCommentActionSchema, { projectId, commentId, itemId, emoji, reacted }, async ({ project, actor }, input) => {
        const request = new Request(`${await appBaseUrl()}/app/projects/${project.id}`, { headers: await headers() });
        await setProjectCommentReaction(request, project, actor, input.commentId, { itemId: input.itemId, emoji: input.emoji, reacted: input.reacted });
    });
}

/** Fetch only on demand, with current membership and private-thread visibility. */
export async function commentParticipantsAction(projectId: string, commentId: string) {
    return actionResult(async () => {
        const input = parseActionInput(commentActionSchema, { projectId, commentId });
        const { project, actor } = await commentContext(input.projectId);
        try {
            assertCanUseComments(project, actor);
            const comment = await getProjectComment(project, actor, input.commentId);
            if (!comment) throw apiErrors.notFound();
            return await eligibleParticipants(project, actor, comment);
        } catch (error) {
            if (error instanceof ApiError && error.code !== 'server_error') throw new UserFacingError(error.message);
            throw error;
        }
    });
}

/** The comment's project (current workspace, visible to the user) and the user as its actor */
async function commentContext(projectId: string) {
    const context = await appContextOrThrow();
    const project = await getVisibleProject(context, projectId);
    if (!project)
        throw new UserFacingError('This project no longer exists.');
    return { context, project, actor: appActor(context) };
}

/** Runs a comment change; the service's API errors (not found, forbidden) become messages */
async function commentAction<T extends { projectId: string }>(schema: z.ZodType<T>, input: unknown,
    change: (scope: Awaited<ReturnType<typeof commentContext>>, input: T) => Promise<unknown>): Promise<ActionState> {
    return await actionResult(async () => {
        const parsed = parseActionInput(schema, input);
        const scope = await commentContext(parsed.projectId);
        try {
            await change(scope, parsed);
        } catch (error) {
            if (error instanceof ApiError && error.code !== 'server_error')
                throw new UserFacingError(error.code === 'not_found' ? 'This comment no longer exists.' : error.message);
            throw error;
        }
        revalidatePath(KnownPageLinks.project(parsed.projectId));
    });
}

/** Open, In progress or Done, with the resolve permission (checked by the service) */
export async function setCommentStatusAction(projectId: string, commentId: string, status: import('@uier/toolbar/verification').FeedbackStatusTarget) {
    return await commentAction(statusCommentActionSchema, { projectId, commentId, status },
        ({ project, actor }, input) => setProjectCommentStatus(project, actor, input.commentId, input.status));
}

export async function setCommentArchivedAction(projectId: string, commentId: string, archived: boolean) {
    return await commentAction(archiveCommentActionSchema, { projectId, commentId, archived },
        ({ project, actor }, input) => setProjectCommentArchived(project, actor, input.commentId, input.archived));
}

export async function setCommentPrivateAction(projectId: string, commentId: string, isPrivate: boolean) {
    return await commentAction(privateCommentActionSchema, { projectId, commentId, isPrivate },
        ({ project, actor }, input) => setProjectCommentPrivate(project, actor, input.commentId, input.isPrivate));
}

export async function setCommentAssigneeAction(projectId: string, commentId: string, assigneeId: string | null) {
    return await commentAction(assignCommentActionSchema, { projectId, commentId, assigneeId },
        ({ project, actor }, input) => setProjectCommentAssignee(project, actor, input.commentId, input.assigneeId));
}

export async function updateCommentAssigneesAction(projectId: string, commentId: string, assigneeIds: string[], mode: import('../../../lib/review/assignments').AssignmentMode) {
    return commentAction(assignCommentsPeopleActionSchema, { projectId, commentId, assigneeIds, mode },
        ({ project, actor }, input) => setProjectCommentAssignees(project, actor, input.commentId, input.assigneeIds, input.mode));
}

export async function editCommentAction(projectId: string, commentId: string, text: string) {
    return await commentAction(editCommentActionSchema, { projectId, commentId, text },
        ({ project, actor }, input) => editProjectCommentText(project, actor, input.commentId, input.text));
}

/**
 * One message, as the toolbar edits it: only by its author or an admin, and only while its saved text is still
 * `expectedText`, so a newer message is never overwritten. Mentions are checked again by the service.
 */
export async function editCommentReplyAction(projectId: string, commentId: string, itemId: string, text: string, expectedText: string, mentions: { userId: string; start: number; end: number }[]) {
    return commentAction(editReplyActionSchema, { projectId, commentId, itemId, text, expectedText, mentions }, async ({ project, actor }, input) => {
        try {
            await editProjectCommentItem(project, actor, input.commentId, input.itemId, { text: input.text, expectedText: input.expectedText, mentions: input.mentions });
        } catch (error) {
            if (error instanceof ApiError && error.code === 'conflict')
                throw new UserFacingError('This message changed while you were editing. Your text is kept. Copy it, then cancel and reopen the edit to see the latest message.');
            throw error;
        }
    });
}

/** The thread's own title; an empty one removes it, so the AI title shows again */
export async function setCommentTitleAction(projectId: string, commentId: string, title: string) {
    return commentAction(titleCommentActionSchema, { projectId, commentId, title },
        ({ project, actor }, input) => setProjectCommentTitle(project, actor, input.commentId, input.title));
}

export async function deleteCommentAction(projectId: string, commentId: string) {
    return await commentAction(commentActionSchema, { projectId, commentId },
        ({ project, actor }, input) => removeProjectComment(project, actor, input.commentId));
}

export async function deleteCommentReplyAction(projectId: string, commentId: string, itemId: string) {
    return commentAction(deleteReplyActionSchema, { projectId, commentId, itemId }, ({ context, project, actor }, input) => {
        if (!context.isAdmin) throw new UserFacingError('Only admins can delete replies in the app.');
        return deleteProjectCommentItem(project, actor, input.commentId, input.itemId);
    });
}

export async function filterCommentAuthorAction(projectId: string, commentId: string, itemId?: string) {
    return actionResult(async () => {
        const input = parseActionInput(filterAuthorActionSchema, { projectId, commentId, itemId });
        const { context, project } = await commentContext(input.projectId);
        return createCommentAuthorFilter(context, project, input.commentId, input.itemId);
    });
}

export async function markCommentReadAction(projectId: string, commentId: string, sequence: number) {
    return await commentAction(readCommentActionSchema, { projectId, commentId, sequence }, async ({ project, actor }, input) => {
        const comment = await getProjectComment(project, actor, input.commentId);
        if (!comment) throw apiErrors.notFound();
        await markThreadRead(comment, actorAuthorId(actor)!, input.sequence);
    });
}

export async function markCommentUnreadAction(projectId: string, commentId: string) {
    return await commentAction(commentActionSchema, { projectId, commentId }, async ({ project, actor }, input) => {
        const comment = await getProjectComment(project, actor, input.commentId);
        if (!comment) throw apiErrors.notFound();
        await markThreadUnread(comment, actorAuthorId(actor)!);
    });
}

export async function markCommentsReadAction(projectId: string, threads: ReadThreadInput[]) {
    return actionResult(async () => {
        const input = parseActionInput(readCommentsActionSchema, { projectId, threads });
        const { project, actor } = await commentContext(input.projectId);
        const result = await markProjectThreadsRead(project, actor, { threads: input.threads });
        revalidatePath(KnownPageLinks.project(input.projectId));
        return result;
    });
}

/** An explicit export, using current workspace/member and private-thread authorization. */
export async function copyIssueAction(projectId: string, commentId: string) {
    return actionResult(async () => {
        const input = parseActionInput(commentActionSchema, { projectId, commentId });
        const { project, actor } = await commentContext(input.projectId);
        try { return await projectFeedbackExport(project, actor, input.commentId, undefined, await appBaseUrl()); }
        catch (error) {
            if (error instanceof ApiError)
                throw new UserFacingError(error.code === 'not_found' ? 'This comment is no longer available.' : error.message);
            throw error;
        }
    });
}

export async function setCommentPriorityAction(projectId: string, commentId: string, priority: import('@uier/toolbar/triage').CommentPriority, idempotencyKey: string) {
    return commentAction(priorityCommentActionSchema, { projectId, commentId, priority, idempotencyKey },
        ({ project, actor }, input) => setProjectCommentPriority(project, actor, input.commentId, input.priority, input.idempotencyKey));
}
/**
 * How one of the board's columns sorts, saved on the project for everyone who opens its board. The people who
 * triage the project may change it (checked again by the service, with the column's choices).
 */
export async function setBoardSortAction(projectId: string, status: BoardColumn, sort: BoardSort) {
    return await actionResult(async () => {
        const input = parseActionInput(boardSortActionSchema, { projectId, status, sort });
        const { project, actor } = await commentContext(input.projectId);
        await saveProjectBoardSort(project, actor, input.status, input.sort);
        revalidatePath(KnownPageLinks.project(input.projectId));
    });
}

/** Expands or collapses the board's Archive column, saved on the project like the columns' sorts (the same people) */
export async function setBoardArchiveAction(projectId: string, expanded: boolean) {
    return await actionResult(async () => {
        const input = parseActionInput(boardArchiveActionSchema, { projectId, expanded });
        const { project, actor } = await commentContext(input.projectId);
        await saveProjectBoardArchive(project, actor, input.expanded);
        revalidatePath(KnownPageLinks.project(input.projectId));
    });
}

/** The agent working under the signed-in member on a thread assigned to them, or `null` to remove it */
export async function setCommentAgentAction(projectId: string, commentId: string, agent: AssigneeAgentInput | null, idempotencyKey: string, agentId?: string, add?: boolean) {
    return commentAction(agentCommentActionSchema, { projectId, commentId, agent, idempotencyKey, agentId, add },
        ({ project, actor }, input) => setProjectCommentAgent(project, actor, input.commentId, input.agent, { idempotencyKey: input.idempotencyKey, agentId: input.agentId, add: input.add }));
}
export async function triageCommentsAction(projectId: string, batch: unknown) {
    return actionResult(async () => {
        const id = parseActionInput(projectIdSchema, projectId);
        const input = parseActionInput(bulkTriageSchema, batch);
        const { project, actor } = await commentContext(id);
        const result = await triageProjectComments(project, actor, input);
        revalidatePath(KnownPageLinks.project(id));
        return result;
    });
}

export async function verificationCommentAction(projectId: string, commentId: string, input: unknown) {
    return commentAction(verificationZ.object({ projectId: projectIdSchema, commentId: commentActionSchema.shape.commentId, input: fixVerificationSchema }),
        { projectId, commentId, input }, ({ project, actor }, parsed) => changeFixVerification(project, actor, parsed.commentId, parsed.input));
}

export async function setCommentPullRequestAction(projectId: string, commentId: string, url: string, remove = false) {
    return commentAction(pullRequestCommentActionSchema, { projectId, commentId, url, remove },
        ({ project, actor }, input) => setProjectCommentPullRequest(project, actor, input.commentId, input.url, input.remove));
}
