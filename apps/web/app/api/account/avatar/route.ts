import { avatarErrors, avatarUrl, MAX_AVATAR_UPLOAD_BYTES, normalizeAvatar, removeUserAvatar, saveUserAvatar } from '@/src/lib/app/avatars';
import { requestSessionUser } from '@/src/lib/app/sessionIdentity';
import { APP_COUNTERS_PARTITION, consume } from '@/src/lib/comments/rateLimits';
import { ApiError, apiErrors, errorResponse } from '@/src/lib/comments/http';
import { getCommentsStore } from '@/src/lib/repo/commentsStore';

export const dynamic = 'force-dynamic';

/** Changes per account per hour: each upload decodes an image */
const AVATAR_CHANGES_PER_HOUR = 30;
/** Room for the multipart boundaries and headers around the file */
const MAX_BODY_BYTES = MAX_AVATAR_UPLOAD_BYTES + 16 * 1024;

/**
 * Only pages of the app itself change the picture. A multipart form needs no CORS preflight, so the
 * `Origin` must be this host, as the browser sends it with every `fetch` POST and DELETE.
 */
function assertAppOrigin(request: Request) {
    const crossSite = apiErrors.forbidden('Cross-site requests are not allowed.');
    const site = request.headers.get('sec-fetch-site');
    if (site && site !== 'same-origin')
        throw crossSite;
    const origin = request.headers.get('origin');
    const host = request.headers.get('host')?.trim().toLowerCase();
    let originHost: string | undefined;
    try { originHost = origin ? new URL(origin).host.toLowerCase() : undefined; }
    catch { throw crossSite; }
    if (!originHost || !host || originHost !== host)
        throw crossSite;
}

async function signedInUser(request: Request) {
    assertAppOrigin(request);
    const user = await requestSessionUser(request);
    if (!user)
        throw new ApiError(401, 'sign_in_required', 'Sign in to change your profile picture.');
    await consume(getCommentsStore(), APP_COUNTERS_PARTITION, { key: `avatar:${user.id}`, limit: AVATAR_CHANGES_PER_HOUR,
        windowSeconds: 60 * 60, reason: 'too_fast', message: 'You changed your picture too often. Try again later.' });
    return user;
}

/** The body, at most {@link MAX_BODY_BYTES}, whatever `Content-Length` says */
async function readBody(request: Request) {
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES)
        throw new ApiError(413, 'too_large', avatarErrors.tooLarge(MAX_AVATAR_UPLOAD_BYTES));
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
        const part = await reader?.read();
        if (!part || part.done) break;
        length += part.value.byteLength;
        if (length > MAX_BODY_BYTES) {
            await reader?.cancel();
            throw new ApiError(413, 'too_large', avatarErrors.tooLarge(MAX_AVATAR_UPLOAD_BYTES));
        }
        chunks.push(part.value);
    }
    return Buffer.concat(chunks);
}

/** `POST /api/account/avatar` with a multipart `file`: the signed-in person's new picture */
export async function POST(request: Request) {
    try {
        const user = await signedInUser(request);
        const contentType = request.headers.get('content-type') ?? '';
        if (contentType.split(';')[0]?.trim().toLowerCase() !== 'multipart/form-data')
            throw new ApiError(415, 'unsupported_media_type', 'Send the picture as multipart/form-data.');
        let file: FormDataEntryValue | null;
        try {
            file = (await new Response(await readBody(request), { headers: { 'Content-Type': contentType } }).formData()).get('file');
        } catch (error) {
            if (error instanceof ApiError) throw error;
            throw apiErrors.invalidRequest('Send the picture as multipart/form-data.');
        }
        if (!(file instanceof Blob))
            throw apiErrors.invalidRequest(avatarErrors.empty);
        const image = await normalizeAvatar(Buffer.from(await file.arrayBuffer()));
        if (image === avatarErrors.type)
            throw new ApiError(415, 'unsupported_media_type', image);
        if (image === avatarErrors.tooLarge(MAX_AVATAR_UPLOAD_BYTES))
            throw new ApiError(413, 'too_large', image);
        if (typeof image === 'string')
            throw apiErrors.invalidRequest(image);
        const saved = await saveUserAvatar(user.id, image, 'upload');
        if (saved.result !== 'saved')
            throw new ApiError(401, 'sign_in_required', 'Sign in to change your profile picture.');
        return Response.json({ url: avatarUrl(saved.user) }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return errorResponse(error);
    }
}

/** `DELETE /api/account/avatar`: initials again */
export async function DELETE(request: Request) {
    try {
        const user = await signedInUser(request);
        await removeUserAvatar(user.id);
        return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return errorResponse(error);
    }
}
