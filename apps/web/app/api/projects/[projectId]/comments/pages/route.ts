import { z } from 'zod';
import { getAppI18n } from '@/src/lib/i18n/server';
import { getAppContext } from '@/src/lib/app/context';
import { getProject } from '@/src/lib/app/projects';
import { hasProjectAccess, loadWorkspaceAccess } from '@/src/lib/app/access';
import { loadAppCommentsSnapshot } from '@/src/lib/app/appCommentsSnapshot';
import { parseCommentsQuery } from '@/src/components/app/comments/commentsQuery';
import { apiErrors, errorResponse, parseJsonBody } from '@/src/lib/comments/http';
import { queryError } from '@/src/lib/commentQuery/service';
import { enforceQueryReadLimits } from '@/src/lib/commentQuery/limits';
import { appActor } from '@/src/lib/app/projectComments';
import { PROJECT_COMMENT_MAX_DEPTH } from '@/src/lib/app/projectCommentPaging';

const laneSchema = z.string().min(1).max(160).regex(/^[a-z][a-zA-Z0-9_~\-]*$/);
const schema = z.object({
    params: z.record(z.string().max(100), z.string().max(2000)),
    lane: laneSchema.optional(),
    depths: z.record(laneSchema, z.number().int().min(1).max(PROJECT_COMMENT_MAX_DEPTH)).optional(),
    cursor: z.string().max(8192).optional(), archiveExpanded: z.boolean().optional(), openId: z.string().max(200).optional()
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
    let response: Response;
    try {
        const site = request.headers.get('sec-fetch-site'), origin = request.headers.get('origin');
        if (site && site !== 'same-origin' && site !== 'none') throw apiErrors.forbidden('Cross-site requests are not allowed.');
        if (origin) {
            let originHost: string;
            try { originHost = new URL(origin).host.toLowerCase(); } catch { throw apiErrors.forbidden(); }
            if (originHost !== (request.headers.get('host') ?? new URL(request.url).host).trim().toLowerCase()) throw apiErrors.forbidden('Cross-site requests are not allowed.');
        }
        const context = await getAppContext();
        if (!context) throw apiErrors.signInRequired();
        const { projectId } = await params;
        const [project, access] = await Promise.all([getProject(context.workspace.id, projectId), loadWorkspaceAccess(context.workspace.id)]);
        if (!project || !hasProjectAccess(access, context.member, project)) throw apiErrors.notFound();
        await enforceQueryReadLimits(request, [{ domain: `project:${project.id}`, project, actor: appActor(context) }]);
        const input = await parseJsonBody(request, schema, 256 * 1024);
        if (input.cursor && !input.lane) throw apiErrors.invalidRequest('Choose a column for this cursor.');
        if (input.depths && (input.cursor || input.lane)) throw apiErrors.invalidRequest('Choose either a page cursor or column depths.');
        const { t } = await getAppI18n();
        const data = await loadAppCommentsSnapshot(context, project, parseCommentsQuery(input.params), undefined, t, { ...input, signal: request.signal });
        if (!data) throw apiErrors.notFound();
        response = Response.json(data);
    } catch (error) {
        try { response = queryError(error); } catch (other) { response = errorResponse(other); }
    }
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Vary', 'Cookie, Accept-Language');
    return response;
}
