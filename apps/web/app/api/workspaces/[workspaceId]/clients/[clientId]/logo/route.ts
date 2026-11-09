import { assertAppOrigin, readAvatarUpload } from '@/src/lib/app/avatarUpload';
import { changeClientLogo, clientLogoAccess } from '@/src/lib/app/clientLogos';
import { clientSummary } from '@/src/lib/app/clients';
import { requestSessionUser } from '@/src/lib/app/sessionIdentity';
import { ApiError, apiErrors, errorResponse } from '@/src/lib/comments/http';
import { APP_COUNTERS_PARTITION, consume } from '@/src/lib/comments/rateLimits';
import { getCommentsStore } from '@/src/lib/repo/commentsStore';

export const dynamic = 'force-dynamic';
type Params = { workspaceId: string; clientId: string };

async function authorize(request: Request, { workspaceId, clientId }: Params) {
    assertAppOrigin(request);
    const user = await requestSessionUser(request);
    if (!user) throw new ApiError(401, 'sign_in_required', 'Sign in to change the client logo.');
    if (!await clientLogoAccess(workspaceId, clientId, user.id, true)) throw apiErrors.notFound('Client not found.');
    await consume(getCommentsStore(), APP_COUNTERS_PARTITION, {
        key: `client-logo:${user.id}`, limit: 30, windowSeconds: 60 * 60,
        reason: 'too_fast', message: 'You changed client logos too often. Try again later.'
    });
    return user;
}

export async function POST(request: Request, { params }: { params: Promise<Params> }) {
    try {
        const ids = await params;
        const user = await authorize(request, ids);
        const image = await readAvatarUpload(request);
        const client = await changeClientLogo(ids.workspaceId, ids.clientId, user.id, image);
        return Response.json({ url: clientSummary(client).logoUrl }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<Params> }) {
    try {
        const ids = await params;
        const user = await authorize(request, ids);
        await changeClientLogo(ids.workspaceId, ids.clientId, user.id, null);
        return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    } catch (error) { return errorResponse(error); }
}
