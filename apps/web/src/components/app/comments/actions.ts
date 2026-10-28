'use server';

import { revalidatePath } from 'next/cache';
import { textSchema } from '../../../lib/comments/validation';
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

/** The comment's project (current workspace, visible to the user) and the user as its actor */
async function commentContext(projectId: string) {
    const context = await appContextOrThrow();
    const project = await getVisibleProject(context, projectId);
    if (!project)
        throw new UserFacingError('This project no longer exists.');
    return { context, project, actor: appActor(context) };
}

/** Runs a comment change; the service's API errors (not found, forbidden) become messages */
async function commentAction(projectId: string, change: (scope: Awaited<ReturnType<typeof commentContext>>) => Promise<unknown>): Promise<ActionState> {
    return await actionResult(async () => {
        const scope = await commentContext(projectId);
        try {
            await change(scope);
        } catch (error) {
            if (error instanceof ApiError && error.code !== 'server_error')
                throw new UserFacingError(error.code === 'not_found' ? 'This comment no longer exists.' : error.message);
            throw error;
        }
        revalidatePath(KnownPageLinks.project(projectId));
    });
}

export async function setCommentResolvedAction(projectId: string, commentId: string, resolved: boolean) {
    return await commentAction(projectId, ({ project, actor }) => setProjectCommentResolved(project, actor, commentId, resolved));
}

export async function setCommentPrivateAction(projectId: string, commentId: string, isPrivate: boolean) {
    return await commentAction(projectId, ({ project, actor }) => setProjectCommentPrivate(project, actor, commentId, isPrivate));
}

export async function setCommentAssigneeAction(projectId: string, commentId: string, assigneeId: string | null) {
    return await commentAction(projectId, async ({ project, actor }) => {
        await setProjectCommentAssignee(project, actor, commentId, assigneeId);
    });
}

export async function editCommentAction(projectId: string, commentId: string, text: string) {
    return await commentAction(projectId, async ({ project, actor }) => {
        const parsed = textSchema.safeParse(text);
        if (!parsed.success)
            throw new UserFacingError('A comment needs text, up to 1000 characters.');
        await editProjectCommentText(project, actor, commentId, parsed.data);
    });
}

export async function deleteCommentAction(projectId: string, commentId: string) {
    return await commentAction(projectId, ({ project, actor }) => removeProjectComment(project, actor, commentId));
}

export async function deleteCommentReplyAction(projectId: string, commentId: string, itemId: string) {
    return commentAction(projectId, ({ context, project, actor }) => {
        if (!context.isAdmin) throw new UserFacingError('Only admins can delete replies in the app.');
        return deleteProjectCommentItem(project, actor, commentId, itemId);
    });
}

export async function filterCommentAuthorAction(projectId: string, commentId: string, itemId?: string) {
    return actionResult(async () => {
        const { context, project } = await commentContext(projectId);
        return createCommentAuthorFilter(context, project, commentId, itemId);
    });
}

export async function markCommentReadAction(projectId: string, commentId: string, sequence: number) {
    return await commentAction(projectId, async ({ project, actor }) => {
        const comment = await getProjectComment(project, actor, commentId);
        if (!comment) throw apiErrors.notFound();
        await markThreadRead(comment, actorAuthorId(actor)!, sequence);
    });
}

export async function markCommentsReadAction(projectId: string, threads: ReadThreadInput[]) {
    return actionResult(async () => {
        const { project, actor } = await commentContext(projectId);
        const result = await markProjectThreadsRead(project, actor, { threads });
        revalidatePath(KnownPageLinks.project(projectId));
        return result;
    });
}

/** An explicit export, using current workspace/member and private-thread authorization. */
export async function copyIssueAction(projectId: string, commentId: string) {
    return actionResult(async () => {
        const { project, actor } = await commentContext(projectId);
        try { return await projectFeedbackExport(project, actor, commentId, undefined, await appBaseUrl()); }
        catch (error) {
            if (error instanceof ApiError)
                throw new UserFacingError(error.code === 'not_found' ? 'This comment is no longer available.' : error.message);
            throw error;
        }
    });
}
