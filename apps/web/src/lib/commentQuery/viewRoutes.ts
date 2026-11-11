import { apiErrors, errorResponse, parseJsonBody } from '../comments/http';
import { APP_COUNTERS_PARTITION, consume } from '../comments/rateLimits';
import { getCommentsStore } from '../repo/commentsStore';
import { reviewApiHandler } from '../review/http';
import {
    COMMENT_QUERY_BODY_BYTES, commentQueryLinkCreateSchema, commentViewCreateSchema,
    commentViewDeleteSchema, commentViewDuplicateSchema, commentViewUpdateSchema,
    createCommentQueryLink, createCommentView, deleteCommentView, duplicateCommentView,
    getCommentQueryLink, getCommentView, listCommentViews, updateCommentView,
    type CommentViewPrincipal
} from './views';

type Operation = 'list' | 'get' | 'create' | 'update' | 'delete' | 'duplicate' | 'linkCreate' | 'linkGet';
type WorkspaceParams = { workspaceId: string; id?: string };
type ReviewParams = { projectId: string; id?: string };
const writes: readonly Operation[] = ['create', 'update', 'delete', 'duplicate', 'linkCreate'];

async function execute(operation: Operation, principal: CommentViewPrincipal, request: Request, id?: string) {
    if (writes.includes(operation)) await consume(getCommentsStore(), APP_COUNTERS_PARTITION, {
        key: `comment-query-writes:${principal.userId}`, limit: 120, windowSeconds: 60,
        reason: 'too_fast', message: 'You are saving queries too quickly. Try again in a moment.'
    });
    switch (operation) {
        case 'list': return Response.json({ views: await listCommentViews(principal) });
        case 'get': return Response.json({ view: await getCommentView(principal, id ?? '') });
        case 'create': return Response.json({ view: await createCommentView(principal, await parseJsonBody(request, commentViewCreateSchema, COMMENT_QUERY_BODY_BYTES)) }, { status: 201 });
        case 'update': return Response.json({ view: await updateCommentView(principal, id ?? '', await parseJsonBody(request, commentViewUpdateSchema, COMMENT_QUERY_BODY_BYTES)) });
        case 'delete':
            await deleteCommentView(principal, id ?? '', await parseJsonBody(request, commentViewDeleteSchema, 2048));
            return new Response(null, { status: 204 });
        case 'duplicate': return Response.json({ view: await duplicateCommentView(principal, id ?? '', await parseJsonBody(request, commentViewDuplicateSchema, 2048)) }, { status: 201 });
        case 'linkCreate': return Response.json({ link: await createCommentQueryLink(principal, await parseJsonBody(request, commentQueryLinkCreateSchema, COMMENT_QUERY_BODY_BYTES)) }, { status: 201 });
        case 'linkGet': return Response.json({ link: await getCommentQueryLink(principal, id ?? '') });
    }
}

/** Cookie APIs are same-origin only, including reads of personal saved filters. */
export function workspaceCommentViewHandler<TParams extends WorkspaceParams>(operation: Operation) {
    return async (request: Request, context: { params: Promise<TParams> }) => {
        let response: Response;
        try {
            const site = request.headers.get('sec-fetch-site'), origin = request.headers.get('origin');
            if (site && site !== 'same-origin' && site !== 'none' || origin && origin !== new URL(request.url).origin)
                throw apiErrors.forbidden('Cross-site requests are not allowed.');
            const { getAppContext } = await import('../app/context');
            const app = await getAppContext();
            if (!app) throw apiErrors.signInRequired();
            const params = await context.params;
            response = await execute(operation, { workspaceId: params.workspaceId, userId: app.user.id }, request, params.id);
        } catch (error) { response = errorResponse(error); }
        response.headers.set('Cache-Control', 'no-store');
        response.headers.append('Vary', 'Cookie, Origin');
        return response;
    };
}

/** Saved toolbar views require a current member; review links and guest ids grant no access. */
export function reviewCommentViewHandler<TParams extends ReviewParams>(operation: Operation) {
    return reviewApiHandler<TParams>(async (context, params) => {
        if (context.actor.kind !== 'member') throw apiErrors.signInRequired('Sign in to manage saved comment views.');
        return execute(operation, { workspaceId: context.project.workspaceId, projectId: context.project.id, userId: context.actor.userId }, context.request, params.id);
    }, { comments: false });
}
