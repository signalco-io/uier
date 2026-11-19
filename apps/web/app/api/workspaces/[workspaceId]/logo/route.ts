import { assertAppOrigin, readPictureUpload } from '@/src/lib/app/avatarUpload';
import { requestSessionUser } from '@/src/lib/app/sessionIdentity';
import { changeWorkspaceLogo, normalizeWorkspaceLogo, workspaceLogoAccess } from '@/src/lib/app/workspaceLogos';
import { apiErrors, errorResponse } from '@/src/lib/comments/http';
import { APP_COUNTERS_PARTITION, consume } from '@/src/lib/comments/rateLimits';
import { getCommentsStore } from '@/src/lib/repo/commentsStore';

async function save(request: Request, workspaceId: string, upload: boolean) {
    try {
        assertAppOrigin(request);
        const user = await requestSessionUser(request);
        if (!user) throw apiErrors.signInRequired('Your session has ended. Sign in again.');
        if (!await workspaceLogoAccess(workspaceId, user.id, true))
            throw apiErrors.notFound('This workspace is unavailable or your access changed.');
        await consume(getCommentsStore(), APP_COUNTERS_PARTITION, {
            key: `workspace-logo:${user.id}`, limit: 30, windowSeconds: 60 * 60,
            reason: 'too_fast', message: 'You changed workspace logos too often. Try again later.'
        });
        const variants = upload ? await normalizeWorkspaceLogo(await readPictureUpload(request)) : null;
        await changeWorkspaceLogo(workspaceId, user.id, variants);
        return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        const response = errorResponse(error);
        response.headers.set('Cache-Control', 'no-store');
        return response;
    }
}

export async function POST(request: Request, { params }: RouteContext<'/api/workspaces/[workspaceId]/logo'>) {
    return save(request, (await params).workspaceId, true);
}

export async function DELETE(request: Request, { params }: RouteContext<'/api/workspaces/[workspaceId]/logo'>) {
    return save(request, (await params).workspaceId, false);
}
