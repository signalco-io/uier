import { getAppContext } from '@/src/lib/app/context';
import { getProject } from '@/src/lib/app/projects';
import { hasProjectAccess, loadWorkspaceAccess } from '@/src/lib/app/access';
import { listMembersWithUsers, membersWithProjectAccess } from '@/src/lib/app/members';
import { loadAppCommentsSnapshot } from '@/src/lib/app/appCommentsSnapshot';
import { parseCommentsQuery } from '@/src/components/app/comments/commentsQuery';
import { apiErrors, errorResponse } from '@/src/lib/comments/http';

/** An opaque revision of this member's current comments view; no shared/public cache. */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
    try {
        const site = request.headers.get('sec-fetch-site');
        if (site && site !== 'same-origin' && site !== 'none') throw apiErrors.forbidden('Cross-site requests are not allowed.');
        const context = await getAppContext();
        if (!context) throw apiErrors.signInRequired();
        const { projectId } = await params;
        const [project, access] = await Promise.all([getProject(context.workspace.id, projectId), loadWorkspaceAccess(context.workspace.id)]);
        if (!project || !hasProjectAccess(access, context.member, project)) throw apiErrors.notFound();
        // Route handlers have no React render cache: reuse this request's project/access when
        // selecting members instead of loading both again through listProjectMembers.
        const members = () => listMembersWithUsers(context.workspace.id).then(entries => membersWithProjectAccess(entries, project, access));
        const query = parseCommentsQuery(Object.fromEntries(new URL(request.url).searchParams));
        const snapshot = await loadAppCommentsSnapshot(context, project, query, members);
        if (!snapshot) throw apiErrors.notFound();
        return Response.json({ revision: snapshot.revision }, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
    } catch (error) {
        const response = errorResponse(error);
        response.headers.set('Cache-Control', 'private, no-store');
        response.headers.set('Vary', 'Cookie');
        return response;
    }
}
