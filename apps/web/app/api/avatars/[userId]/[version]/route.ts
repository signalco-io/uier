import { getAvatarImage } from '@/src/lib/app/avatars';
import { requestSessionUser } from '@/src/lib/app/sessionIdentity';
import { userIdSchema } from '@/src/lib/app/validation';


const noStore = { 'Cache-Control': 'private, no-store' };

/**
 * A person's profile picture, for signed-in app users. The address names the picture's random
 * version, which only pages that show the person hand out; a replaced or removed picture is gone.
 * Versions never change their bytes, so the browser keeps them; shared caches never do.
 */
export async function GET(request: Request, { params }: RouteContext<'/api/avatars/[userId]/[version]'>) {
    const { userId, version } = await params;
    if (!await requestSessionUser(request))
        return new Response(null, { status: 401, headers: noStore });
    const avatar = userIdSchema.safeParse(userId).success ? await getAvatarImage(userId, version) : null;
    if (!avatar)
        return new Response(null, { status: 404, headers: noStore });
    const data = Buffer.from(avatar.data, 'base64');
    return new Response(new Uint8Array(data), {
        headers: {
            // Every stored picture is WebP (`normalizeAvatar`); never echo a type from storage
            'Content-Type': 'image/webp',
            'Content-Length': String(data.length),
            'Cache-Control': 'private, max-age=31536000, immutable',
            'Content-Disposition': 'inline',
            'Cross-Origin-Resource-Policy': 'same-origin',
            'X-Content-Type-Options': 'nosniff'
        }
    });
}
