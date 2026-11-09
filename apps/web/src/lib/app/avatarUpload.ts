import { ApiError, apiErrors } from '../comments/http';
import { avatarErrors, MAX_AVATAR_UPLOAD_BYTES, normalizeAvatar } from './avatars';

const MAX_BODY_BYTES = MAX_AVATAR_UPLOAD_BYTES + 16 * 1024;

/**
 * Only pages of the app itself change the picture. A multipart form needs no CORS preflight, so the
 * `Origin` must be this host, as the browser sends it with every `fetch` POST and DELETE.
 */
export function assertAppOrigin(request: Request) {
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

/** Shared upload validation for profile pictures and client logos. */
export async function readAvatarUpload(request: Request) {
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
    return image;
}
