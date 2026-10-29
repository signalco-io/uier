import { cookies } from 'next/headers';
import { z } from 'zod';
import { appBaseUrl } from '@/src/lib/app/request';
import { REVIEW_SSO_COOKIE_NAME, readReviewSsoSession } from '@/src/lib/app/reviewSsoCookie';
import { findReviewProject, projectOrigins } from '@/src/lib/app/projects';
import { apiErrors, errorResponse, parseJsonBody } from '@/src/lib/comments/http';
import { memberActor, REVIEW_TOKEN_TTL_SECONDS } from '@/src/lib/review/actor';
import { signToken } from '@/src/lib/app/tokens';

export const dynamic = 'force-dynamic';

/** Only the uier frame calls this cookie endpoint. The reviewed site receives no app credential. */
export async function POST(request: Request, { params }: RouteContext<'/api/review/[projectId]/sso'>) {
    let response: Response;
    try {
        const origin = new URL(await appBaseUrl()).origin;
        if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site')
            throw apiErrors.forbidden();
        const input = await parseJsonBody(request, z.object({ origin: z.string().url().max(512) }));
        const { projectId } = await params;
        const project = await findReviewProject(projectId);
        if (!project || project.access === 'disabled' || !projectOrigins(project).includes(input.origin))
            throw apiErrors.forbidden();
        const session = readReviewSsoSession((await cookies()).get(REVIEW_SSO_COOKIE_NAME)?.value);
        const actor = session ? await memberActor(project, session.uid) : null;
        if (!session || !actor) {
            response = new Response(null, { status: 204 });
        } else {
            // Never extend the login that authorized this background handoff.
            const ttl = Math.min(REVIEW_TOKEN_TTL_SECONDS, session.exp - Math.floor(Date.now() / 1000));
            response = Response.json({ token: signToken('review', { uid: session.uid, pid: project.id }, ttl) });
        }
    } catch (error) {
        response = errorResponse(error);
    }
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
