import { requestSessionUser } from '@/src/lib/app/sessionIdentity';
import { workspaceLogoSizes } from '@/src/lib/app/workspaceLogoSizes';
import { getWorkspaceLogo } from '@/src/lib/app/workspaceLogos';

const noStore = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request, { params }: RouteContext<'/api/workspaces/[workspaceId]/logo/[version]'>) {
    const user = await requestSessionUser(request);
    if (!user) return new Response(null, { status: 401, headers: noStore });
    const { workspaceId, version } = await params;
    const logo = await getWorkspaceLogo(workspaceId, version, user.id);
    if (!logo) return new Response(null, { status: 404, headers: noStore });
    const requestedSize = new URL(request.url).searchParams.get('size');
    const size = workspaceLogoSizes.find(candidate => String(candidate) === requestedSize);
    if (!size) return new Response(null, { status: 400, headers: noStore });

    const etag = `"${version}-${size}"`;
    const headers = {
        // A warm browser cache still has to recheck membership and whether this version is current.
        'Cache-Control': 'private, no-cache',
        ETag: etag,
        Vary: 'Cookie',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'X-Content-Type-Options': 'nosniff'
    };
    const validators = request.headers.get('if-none-match')?.split(',').map(tag => tag.trim().replace(/^W\//, ''));
    if (validators?.includes(etag) || validators?.includes('*'))
        return new Response(null, { status: 304, headers });

    const data = Buffer.from(logo.variants[size], 'base64');
    return new Response(new Uint8Array(data), { headers: {
        ...headers, 'Content-Type': 'image/webp', 'Content-Length': String(data.length)
    } });
}
