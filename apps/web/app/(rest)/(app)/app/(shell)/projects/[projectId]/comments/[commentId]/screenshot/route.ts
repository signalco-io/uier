import { getAppContext } from '@/src/lib/app/context';
import { getVisibleProject } from '@/src/lib/app/projects';
import { appActor } from '@/src/lib/app/projectComments';
import { ApiError } from '@/src/lib/comments/http';
import { screenshotResponse } from '@/src/lib/comments/screenshot';
import { isValidId } from '@/src/lib/comments/validation';
import { getProjectScreenshot } from '@/src/lib/review/comments';

export const dynamic = 'force-dynamic';

/** The screenshot of a project comment, for app users who can see the comment */
export async function GET(_request: Request, { params }: RouteContext<'/app/projects/[projectId]/comments/[commentId]/screenshot'>) {
    const { projectId, commentId } = await params;
    const context = await getAppContext();
    if (!context)
        return new Response(null, { status: 401 });
    const project = await getVisibleProject(context, projectId);
    if (!project || !isValidId(commentId))
        return new Response(null, { status: 404 });

    try {
        const response = await screenshotResponse(await getProjectScreenshot(project, appActor(context), commentId), 'redirect');
        response.headers.set('Cache-Control', 'private, no-store');
        return response;
    } catch (error) {
        if (error instanceof ApiError)
            return new Response(null, { status: error.status });
        throw error;
    }
}
