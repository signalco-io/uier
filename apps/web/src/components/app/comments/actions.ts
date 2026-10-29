'use server';

import { revalidatePath } from 'next/cache';
import type { z } from 'zod';
import { parseActionInput } from '../../../lib/app/validation';
import { actionResult, UserFacingError, type ActionState } from '../../../lib/app/actionResult';
import { appContextOrThrow } from '../../../lib/app/context';
import { getVisibleProject } from '../../../lib/app/projects';
import { appActor } from '../../../lib/app/projectComments';
import { ApiError } from '../../../lib/comments/http';
import {
    getProjectComment,
    deleteProjectCommentItem,
    editProjectCommentText,
    removeProjectComment,
    setProjectCommentAssignee,
    setProjectCommentPrivate,
    setProjectCommentResolved
} from '../../../lib/review/comments';
import { markThreadRead } from '../../../lib/comments/readState';
import { actorAuthorId } from '../../../lib/review/actor';
import { apiErrors } from '../../../lib/comments/http';
import { KnownPageLinks } from '../../../knownPages';
import { appBaseUrl } from '../../../lib/app/request';
import { projectFeedbackExport } from '../../../lib/review/feedbackContext';
import { markProjectThreadsRead } from '../../../lib/review/bulkRead';
import type { ReadThreadInput } from '../../../lib/comments/bulkRead';
import { createCommentAuthorFilter } from '../../../lib/app/commentAuthors';
import { assignCommentActionSchema, commentActionSchema, deleteReplyActionSchema, editCommentActionSchema,
    filterAuthorActionSchema, privateCommentActionSchema, readCommentActionSchema, readCommentsActionSchema,
    resolveCommentActionSchema } from './actionSchemas';

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

export async function setCommentResolvedAction(projectId: string, commentId: string, resolved: boolean) {
    return await commentAction(resolveCommentActionSchema, { projectId, commentId, resolved },
        ({ project, actor }, input) => setProjectCommentResolved(project, actor, input.commentId, input.resolved));
}

export async function setCommentPrivateAction(projectId: string, commentId: string, isPrivate: boolean) {
    return await commentAction(privateCommentActionSchema, { projectId, commentId, isPrivate },
        ({ project, actor }, input) => setProjectCommentPrivate(project, actor, input.commentId, input.isPrivate));
}

export async function setCommentAssigneeAction(projectId: string, commentId: string, assigneeId: string | null) {
    return await commentAction(assignCommentActionSchema, { projectId, commentId, assigneeId },
        ({ project, actor }, input) => setProjectCommentAssignee(project, actor, input.commentId, input.assigneeId));
}

export async function editCommentAction(projectId: string, commentId: string, text: string) {
    return await commentAction(editCommentActionSchema, { projectId, commentId, text },
        ({ project, actor }, input) => editProjectCommentText(project, actor, input.commentId, input.text));
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
