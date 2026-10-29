import { apiErrors, errorResponse } from '../comments/http';
import { findReviewProject, projectOrigins } from '../app/projects';
import type { DbProject } from '../app/model';
import { assertCanUseComments, resolveActor, VISITOR_HEADER, type ProjectActor } from './actor';
import { assertVerifiedWrite, VERIFICATION_HEADER } from './verification';

export type ReviewApiContext = {
    request: Request;
    project: DbProject;
    actor: ProjectActor;
    /** Origin of the project's site the request came from; missing for requests without `Origin` */
    siteOrigin?: string;
};

type ReviewParams = { projectId: string };

/** The API's own origin (requests from uier.io pages are same-origin and need no CORS) */
function ownOrigin(request: Request) {
    const host = request.headers.get('host');
    const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || new URL(request.url).protocol.replace(':', '');
    return host ? `${protocol}://${host}` : new URL(request.url).origin;
}

/**
 * The `Origin` of a cross-origin request if it is one of the project's sites. Requests from any
 * other site are rejected: the toolbar of a project only works on the addresses in its settings.
 */
function allowedSiteOrigin(request: Request, project: DbProject) {
    const origin = request.headers.get('origin');
    if (!origin || origin === ownOrigin(request))
        return undefined;
    if (!projectOrigins(project).includes(origin))
        throw apiErrors.forbidden('This site is not one of the project\'s addresses.');
    return origin;
}

function corsHeaders(headers: Headers, origin: string | undefined) {
    headers.append('Vary', 'Origin');
    if (!origin)
        return;
    // Reviewers are identified by headers (a review token or a visitor id), never by cookies
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Expose-Headers', 'Retry-After');
}

/**
 * Wraps a review API route (the toolbar of a project, on the project's own sites): finds the
 * project, allows CORS only for its addresses, resolves the reviewer and checks that comments are on
 * and open to them (`comments: false` for the routes that tell the toolbar what is allowed).
 */
export function reviewApiHandler<TParams extends ReviewParams>(
    handler: (context: ReviewApiContext, params: TParams) => Promise<Response>,
    { comments = true, verifyWrites = true } = {}
) {
    return async (request: Request, routeContext: { params: Promise<TParams> }) => {
        let siteOrigin: string | undefined;
        let response: Response;
        try {
            const params = await routeContext.params;
            const project = await findReviewProject(params.projectId);
            if (!project)
                throw apiErrors.notFound('Project not found.');

            siteOrigin = allowedSiteOrigin(request, project);
            const actor = await resolveActor(request, project);
            if (comments)
                assertCanUseComments(project, actor);
            const context = { request, project, actor, siteOrigin };
            if (verifyWrites && request.method !== 'GET' && request.method !== 'HEAD')
                await assertVerifiedWrite(context);
            response = await handler(context, params);
        } catch (error) {
            response = errorResponse(error);
        }

        const headers = new Headers(response.headers);
        headers.set('Cache-Control', 'no-store');
        corsHeaders(headers, siteOrigin);
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    };
}

/** CORS preflight of a review API route: allowed for the project's own sites only */
export function reviewPreflight(methods: string) {
    return async (request: Request, routeContext: { params: Promise<ReviewParams> }) => {
        const headers = new Headers({ 'Cache-Control': 'no-store' });
        try {
            const { projectId } = await routeContext.params;
            const project = await findReviewProject(projectId);
            const origin = project ? allowedSiteOrigin(request, project) : undefined;
            corsHeaders(headers, origin);
            if (origin) {
                headers.set('Access-Control-Allow-Methods', methods);
                headers.set('Access-Control-Allow-Headers', `Content-Type, Authorization, ${VISITOR_HEADER}, ${VERIFICATION_HEADER}`);
                headers.set('Access-Control-Max-Age', '600');
            }
        } catch {
            // Not allowed: no CORS headers, so the browser blocks the request
            headers.append('Vary', 'Origin');
        }
        return new Response(null, { status: 204, headers });
    };
}
