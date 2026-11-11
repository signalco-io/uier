import { avatarUrl, removeUserAvatar, saveUserAvatar } from '@/src/lib/app/avatars';
import { assertAppOrigin, readAvatarUpload } from '@/src/lib/app/avatarUpload';
import { requestSessionUser } from '@/src/lib/app/sessionIdentity';
import { APP_COUNTERS_PARTITION, consume } from '@/src/lib/comments/rateLimits';
import { ApiError, errorResponse } from '@/src/lib/comments/http';
import { getCommentsStore } from '@/src/lib/repo/commentsStore';


/** Changes per account per hour: each upload decodes an image */
const AVATAR_CHANGES_PER_HOUR = 30;
async function signedInUser(request: Request) {
    assertAppOrigin(request);
    const user = await requestSessionUser(request);
    if (!user)
        throw new ApiError(401, 'sign_in_required', 'Sign in to change your profile picture.');
    await consume(getCommentsStore(), APP_COUNTERS_PARTITION, { key: `avatar:${user.id}`, limit: AVATAR_CHANGES_PER_HOUR,
        windowSeconds: 60 * 60, reason: 'too_fast', message: 'You changed your picture too often. Try again later.' });
    return user;
}

/** `POST /api/account/avatar` with a multipart `file`: the signed-in person's new picture */
export async function POST(request: Request) {
    try {
        const user = await signedInUser(request);
        const image = await readAvatarUpload(request);
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
