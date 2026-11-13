import { apiErrors, commentContext, commentsApiHandler, errorResponse, parseJsonBody, writerId, type CommentsApiContext } from '../comments/http';
import { assertNotBot } from '../comments/botProtection';
import { getComment } from '../comments/service';
import { isValidId } from '../comments/validation';
import { actorAuthorId, assertCanUseComments, assertWriter } from '../review/actor';
import { getProjectComment, projectPartition } from '../review/comments';
import type { ReviewApiContext } from '../review/http';
import { getCommentsStore } from '../repo/commentsStore';
import { commentRecordingUrl, completeRecordingUpload, recordingUploadSchema, startRecordingUpload } from './service';
import { localRecordingFile } from './blobStore';

const checkedId = (id: string) => { if (!isValidId(id)) throw apiErrors.notFound(); return id; };
export async function startReviewRecording({ request, project, actor }: ReviewApiContext) {
    assertWriter(actor);
    return Response.json(await startRecordingUpload(request, projectPartition(project.id), actorAuthorId(actor)!, await parseJsonBody(request, recordingUploadSchema)));
}
export async function completeReviewRecording({ project, actor }: ReviewApiContext, { id }: { id: string }) {
    assertWriter(actor);
    return Response.json(await completeRecordingUpload(projectPartition(project.id), actorAuthorId(actor)!, checkedId(id)));
}
export async function readReviewRecording({ request, project, actor }: ReviewApiContext, { id, itemId }: { id: string; itemId?: string }) {
    const comment = await getProjectComment(project, actor, checkedId(id));
    if (itemId) checkedId(itemId);
    if (!comment) throw apiErrors.notFound();
    return Response.json(await commentRecordingUrl(request, comment, itemId));
}
export const startPublicRecording = commentsApiHandler(async context => {
    await assertNotBot();
    return Response.json(await startRecordingUpload(context.request, context.domain, writerId(context), await parseJsonBody(context.request, recordingUploadSchema)));
});
export const completePublicRecording = commentsApiHandler<{ id: string }>(async (context, { id }) => {
    await assertNotBot();
    return Response.json(await completeRecordingUpload(context.domain, writerId(context), checkedId(id)));
});
export const readPublicRecording = commentsApiHandler<{ id: string; itemId?: string }>(async (source, { id, itemId }) => {
    const context: CommentsApiContext = await commentContext(source, checkedId(id));
    if (itemId) checkedId(itemId);
    await getComment(context, id); // Includes the public project's author-only visibility rules.
    const stored = await getCommentsStore().get(context.domain, id);
    if (!stored) throw apiErrors.notFound();
    return Response.json(await commentRecordingUrl(context.request, stored.comment, itemId));
});

/** Cookie-authenticated app routes resolve current workspace access on every request. */
export function appRecordingRoute(operation: 'start' | 'complete' | 'read') {
    return async (request: Request, route: { params: Promise<{ projectId: string; id?: string; itemId?: string }> }) => {
        let response: Response;
        try {
            const { appBaseUrl } = await import('../app/request');
            const site = request.headers.get('sec-fetch-site'), origin = request.headers.get('origin');
            if (site && site !== 'same-origin' && site !== 'none' || origin && origin !== new URL(await appBaseUrl()).origin)
                throw apiErrors.forbidden('Cross-site requests are not allowed.');
            const { getAppContext } = await import('../app/context');
            const { getProject } = await import('../app/projects');
            const { hasProjectAccess, loadWorkspaceAccess } = await import('../app/access');
            const { appActor } = await import('../app/projectComments');
            const context = await getAppContext();
            if (!context) throw apiErrors.signInRequired();
            const params = await route.params;
            const [project, access] = await Promise.all([getProject(context.workspace.id, params.projectId), loadWorkspaceAccess(context.workspace.id)]);
            if (!project || !hasProjectAccess(access, context.member, project)) throw apiErrors.notFound();
            const actor = appActor(context), review = { request, project, actor };
            if (operation !== 'read') assertCanUseComments(project, actor);
            response = operation === 'start' ? await startReviewRecording(review)
                : operation === 'complete' ? await completeReviewRecording(review, { id: params.id! })
                    : await readReviewRecording(review, { id: params.id!, itemId: params.itemId });
        } catch (error) { response = errorResponse(error); }
        response.headers.set('Cache-Control', 'private, no-store');
        response.headers.set('Vary', 'Cookie');
        return response;
    };
}
export async function localRecordingRoute(request: Request, context: { params: Promise<{ id: string }> }) {
    let response: Response;
    try { response = await localRecordingFile(request, checkedId((await context.params).id)); }
    catch (error) { response = errorResponse(error); }
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
}
export const localRecordingPreflight = () => new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, PUT, HEAD', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store'
} });
