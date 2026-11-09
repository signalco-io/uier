import { getClientLogoImage } from '@/src/lib/app/clientLogos';
import { requestSessionUser } from '@/src/lib/app/sessionIdentity';
import { errorResponse } from '@/src/lib/comments/http';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string; clientId: string; version: string }> }) {
    try {
        const user = await requestSessionUser(request);
        if (!user) return new Response(null, { status: 401, headers: noStore });
        const { workspaceId, clientId, version } = await params;
        const image = await getClientLogoImage(workspaceId, clientId, version, user.id);
        if (!image) return new Response(null, { status: 404, headers: noStore });
        const data = Buffer.from(image.data, 'base64');
        return new Response(new Uint8Array(data), { headers: {
            'Content-Type': 'image/webp', 'Content-Length': String(data.length),
            'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Disposition': 'inline',
            'Cross-Origin-Resource-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff'
        } });
    } catch (error) { return errorResponse(error); }
}
