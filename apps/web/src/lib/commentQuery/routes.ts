import { z } from 'zod';
import { parseQuery, queryFields, type FieldId, type QueryDocument } from '@uier/comments-query';
import { getProject, listProjects } from '../app/projects';
import { hasProjectAccess, loadWorkspaceAccess } from '../app/access';
import { appActor } from '../app/projectComments';
import { apiErrors, commentsApiHandler, errorResponse, parseJsonBody, type CommentsApiContext } from '../comments/http';
import { reviewApiHandler, reviewPreflight } from '../review/http';
import { projectPartition } from '../review/comments';
import { enforceQueryReadLimits } from './limits';
import { capabilities, executeQuery, queryError, queryFacets, queryOptions, type QueryExecutionContext, type QuerySource } from './service';

const inputSchema = z.object({
    query: z.unknown(), page: z.object({ size: z.number().int().min(1).max(100).optional(), cursor: z.string().max(32768).optional() }).strict().optional(),
    currentPage: z.string().max(2000).startsWith('/').optional(), currentEnvironment: z.string().min(1).max(2000).optional(),
    facets: z.array(z.enum(queryFields)).max(8).optional(),
    field: z.enum(queryFields).optional(), search: z.string().max(200).optional(), offset: z.number().int().nonnegative().max(100000).optional()
}).strict();
type Operation = 'query' | 'counts' | 'options' | 'capabilities';
async function run(request: Request, context: QueryExecutionContext, operation: Operation) {
    if (operation === 'capabilities') return Response.json({ ...capabilities(context.sources), scope: context.scope });
    await enforceQueryReadLimits(request, context.sources);
    const input = await parseJsonBody(request, inputSchema, 96 * 1024);
    const query = parseQuery(input.query);
    const execution = { ...context, signal: request.signal, currentPage: input.currentPage, currentEnvironment: input.currentEnvironment };
    if (operation === 'counts') return Response.json(await queryFacets(query, execution, input.facets ?? ['status']));
    if (operation === 'options') {
        if (!input.field) throw apiErrors.invalidRequest('Choose an options field.');
        return Response.json(await queryOptions(query, execution, input.field as FieldId, input.search, input.offset));
    }
    return Response.json(await executeQuery(query, execution, input.page));
}
function queryFailure(error: unknown) {
    try { return queryError(error); } catch (other) { return errorResponse(other); }
}
async function appContext(params: { projectId?: string; workspaceId?: string }): Promise<QueryExecutionContext> {
    const { getAppContext } = await import('../app/context');
    const context = await getAppContext();
    if (!context) throw apiErrors.signInRequired();
    if (params.workspaceId && params.workspaceId !== context.workspace.id) throw apiErrors.notFound();
    const access = await loadWorkspaceAccess(context.workspace.id);
    const projects = params.projectId ? [await getProject(context.workspace.id, params.projectId)].filter(p => p !== null)
        : await listProjects(context.workspace.id);
    const visible = projects.filter(project => hasProjectAccess(access, context.member, project));
    if (params.projectId && !visible.length) throw apiErrors.notFound();
    return { sources: visible.map(project => ({ domain: projectPartition(project.id), project, actor: appActor(context) })),
        scope: params.projectId ? { kind: 'project', projectId: visible[0]!.id } : { kind: 'workspace', workspaceId: context.workspace.id } };
}
export function appQueryRoute(operation: Operation) {
    return async (request: Request, route: { params: Promise<{ projectId?: string; workspaceId?: string }> }) => {
        let response: Response;
        try {
            const site = request.headers.get('sec-fetch-site');
            if (site && site !== 'same-origin' && site !== 'none') throw apiErrors.forbidden('Cross-site requests are not allowed.');
            if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin)
                throw apiErrors.forbidden('Cross-site requests are not allowed.');
            response = await run(request, await appContext(await route.params), operation);
        } catch (error) { response = queryFailure(error); }
        response.headers.set('Cache-Control', 'private, no-store');
        response.headers.set('Vary', 'Cookie');
        return response;
    };
}
export function reviewQueryRoute(operation: Operation) {
    // These POSTs only read data. They retain fresh actor resolution, project policy and CORS.
    return reviewApiHandler(async context => {
        try { return await run(context.request, { sources: [{ domain: projectPartition(context.project.id), project: context.project, actor: context.actor }],
            scope: { kind: 'project', projectId: context.project.id } }, operation); }
        catch (error) { return queryFailure(error); }
    }, { verifyWrites: false });
}
export const queryPreflight = reviewPreflight('GET, POST');
function publicSources(context: CommentsApiContext): QuerySource[] {
    return [{ domain: context.domain, project: context.project, actor: (context.actor?.kind === 'member' ? { ...context.actor, isAdmin: false } : context.actor) ?? (context.visitor.authorId ? { kind: 'guest', visitorId: context.visitor.authorId } : { kind: 'anonymous' }) },
        ...(context.publicFeedback ? publicSources(context.publicFeedback) : [])];
}
export function publicQueryRoute(operation: Operation) {
    return commentsApiHandler(async context => {
        try { return await run(context.request, { sources: publicSources(context), scope: { kind: 'public' } }, operation); }
        catch (error) { return queryFailure(error); }
    }, { createVisitor: false });
}
export type { QueryDocument };


/** App detail uses the existing app view model and rechecks the selected workspace. */
export async function appCommentDetail(request: Request, route: { params: Promise<{ projectId: string; id: string }> }) {
    let response: Response;
    try {
        const site = request.headers.get('sec-fetch-site'), origin = request.headers.get('origin');
        if (site && site !== 'same-origin' && site !== 'none' || origin && origin !== new URL(request.url).origin) throw apiErrors.forbidden('Cross-site requests are not allowed.');
        const { getAppContext } = await import('../app/context');
        const context = await getAppContext();
        if (!context) throw apiErrors.signInRequired();
        const { projectId, id } = await route.params;
        const [project, access] = await Promise.all([getProject(context.workspace.id, projectId), loadWorkspaceAccess(context.workspace.id)]);
        if (!project || !hasProjectAccess(access, context.member, project)) throw apiErrors.notFound();
        const { loadProjectComment } = await import('../app/projectComments');
        const comment = await loadProjectComment(context, project, id);
        if (!comment) throw apiErrors.notFound();
        response = Response.json(comment);
    } catch (error) { response = errorResponse(error); }
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Vary', 'Cookie');
    return response;
}
