import { z } from 'zod';
import { assertAppOrigin } from '../app/avatarUpload';
import { ensureProjectPublicId } from '../app/projectPublicIds';
import { memberReviewTarget } from '../app/review';
import { ApiError, errorResponse, parseJsonBody } from '../comments/http';
import { isValidId } from '../comments/validation';
import { getCommentsStore } from '../repo/commentsStore';
import { commentPageCursor, formatCommentPageCursor } from '../repo/commentPage';
import { listPage } from '../comments/listPage';
import { canSeeComment, commentVisibilityFilter, getProjectComment, projectPartition } from '../review/comments';
import { proofProject, requireProofMember } from './access';
import { stagingSurfacePath, stagingApiPath } from './stagingModel';
import { createStagingPair, listStagingPairs, matchesStagingThread, memberStagingPair, revokeStagingPair, stagingPairingId, stagingPairingInput } from './staging';
import { proofNotFound } from './store';

const listInput = stagingPairingInput.pick({ assetId: true, versionId: true, surfaceId: true });

async function handleStaging(request: Request, projectId: string, segments: string[]) {
    const method = request.method;
    const query = new URL(request.url).searchParams;
    const [id, action] = segments;
    if (segments.length === 0) {
        if (method === 'GET') {
            const input = listInput.safeParse(Object.fromEntries(query));
            if (!input.success) throw proofNotFound();
            return Response.json(await listStagingPairs(request, projectId, input.data));
        }
        if (method === 'POST') return Response.json(await createStagingPair(request, projectId, await parseJsonBody(request, stagingPairingInput, 8_192)), { status: 201 });
    }
    if (segments.length === 1 && method === 'DELETE' && stagingPairingId.safeParse(id).success) {
        await revokeStagingPair(request, projectId, id!);
        return new Response(null, { status: 204 });
    }
    if (segments.length !== 2 || method !== 'GET') throw proofNotFound();
    const project = await proofProject(projectId);
    const actor = await requireProofMember(request, project);
    const { publicId } = await ensureProjectPublicId(project);
    if (id === 'thread' && action && isValidId(action)) {
        const comment = await getProjectComment(project, actor, action);
        if (!comment?.stagingDesign) throw proofNotFound();
        const { pair } = await memberStagingPair(project.id, comment.stagingDesign.pairingId, actor.userId);
        if (!matchesStagingThread(comment, pair)) throw proofNotFound();
        return new Response(null, { status: 303, headers: { Location: stagingSurfacePath(publicId, pair) } });
    }
    const { pair } = await memberStagingPair(project.id, id ?? '', actor.userId);
    if (action === 'design') return new Response(null, { status: 303, headers: { Location: stagingSurfacePath(publicId, pair) } });
    if (action === 'open') {
        const commentId = query.get('comment');
        if (commentId) {
            if (!isValidId(commentId)) throw proofNotFound();
            const comment = await getProjectComment(project, actor, commentId);
            if (!comment || !matchesStagingThread(comment, pair)) throw proofNotFound();
        }
        const target = await memberReviewTarget(actor.userId, publicId, pair.url, commentId);
        if (!target) throw proofNotFound();
        const url = new URL(target);
        url.searchParams.set('uier-design', pair.pairingId);
        return new Response(null, { status: 303, headers: { Location: url.href } });
    }
    if (action === 'threads') {
        const page = listPage(query);
        const partition = projectPartition(project.id);
        const limit = page?.limit ?? 20;
        const rows = await getCommentsStore().listPage(partition, { ...page, limit, stagingPairingId: pair.pairingId,
            originFilter: { origins: [pair.origin] }, path: pair.page, visibility: commentVisibilityFilter(partition, actor) });
        await memberStagingPair(project.id, pair.pairingId, actor.userId);
        return Response.json({
            threads: rows.filter(comment => matchesStagingThread(comment, pair) && canSeeComment(comment, actor)).map(comment => ({
                id: comment.id, number: comment.number,
                href: `${stagingApiPath(publicId)}/${pair.pairingId}/open?${new URLSearchParams({ comment: comment.id })}`
            })),
            next: rows.length >= limit ? formatCommentPageCursor(commentPageCursor(rows.at(-1)!)) : null
        });
    }
    throw proofNotFound();
}

export async function stagingApi(request: Request, { params }: { params: Promise<{ projectId: string; stagingPath?: string[] }> }) {
    let response;
    try {
        const { projectId, stagingPath = [] } = await params;
        const site = request.headers.get('sec-fetch-site');
        const navigation = request.method === 'GET' && request.headers.get('sec-fetch-mode') === 'navigate'
            && request.headers.get('sec-fetch-dest') === 'document'
            && (stagingPath[0] === 'thread' || stagingPath[1] === 'open' || stagingPath[1] === 'design');
        if (site && site !== 'same-origin' && site !== 'none' && !navigation) throw proofNotFound();
        if (request.method !== 'GET') assertAppOrigin(request);
        response = await handleStaging(request, projectId, stagingPath);
    } catch (error) {
        if (!(error instanceof ApiError)) console.error('[staging review] Request failed.');
        response = errorResponse(error instanceof ApiError ? error : new ApiError(500, 'server_error', 'The request could not be completed.'));
    }
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return response;
}
