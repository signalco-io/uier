import { findProject } from '@/src/lib/app/projects';
import { parseProjectIconSize } from '@/src/lib/app/projectIconSizes';
import { requestSessionUser } from '@/src/lib/app/sessionIdentity';
import { getSiteIcon, MISSING_SITE_ICON_MAX_AGE, SITE_ICON_MAX_AGE } from '@/src/lib/app/siteIcons';
import { siteIconVariant } from '@/src/lib/app/siteIconVariants';
import { siteIconContentSecurityPolicy } from '@/src/lib/secureHeaders';
import { memberActor } from '@/src/lib/review/actor';


const noStore = { 'Cache-Control': 'private, no-store' };

/**
 * The icon of one of a project's addresses (`?site=`, exactly as stored) for its members, fetched by
 * uier's server (`getSiteIcon`) so the viewer's browser never contacts the site. A `404` (also kept
 * by the browser for a while) means the site has no icon the server could load; the tile shows the
 * project's first letter.
 */
export async function GET(request: Request, { params }: RouteContext<'/api/projects/[projectId]/icon'>) {
    const { projectId } = await params;
    const user = await requestSessionUser(request);
    if (!user)
        return new Response(null, { status: 401, headers: noStore });
    const query = new URL(request.url).searchParams;
    const site = query.get('site');
    const project = site ? await findProject(projectId) : null;
    if (!site || !project?.urls.includes(site) || !await memberActor(project, user.id))
        return new Response(null, { status: 404, headers: noStore });
    const requestedSize = query.get('size');
    const size = requestedSize === null ? undefined : parseProjectIconSize(requestedSize);
    if (requestedSize !== null && size === undefined)
        return new Response(null, { status: 400, headers: noStore });
    const source = await getSiteIcon(site);
    if (!source)
        return new Response(null, { status: 404, headers: { 'Cache-Control': `private, max-age=${MISSING_SITE_ICON_MAX_AGE}`, Vary: 'Cookie' } });
    const icon = size === undefined ? source : await siteIconVariant(source, size);
    return new Response(new Uint8Array(icon.data), {
        headers: {
            // Sniffed from the source bytes or set by the variant encoder.
            'Content-Type': icon.contentType,
            'Content-Length': String(icon.data.length),
            'Cache-Control': `private, max-age=${SITE_ICON_MAX_AGE}`,
            Vary: 'Cookie',
            // A site's SVG never runs as a uier.io page: opened on its own it downloads (an `<img>` ignores
            // this), and the policy (also set by `proxy.ts`, whose page policy would replace it) stops its scripts and loads
            'Content-Security-Policy': siteIconContentSecurityPolicy,
            'Content-Disposition': 'attachment; filename="icon"',
            'Cross-Origin-Resource-Policy': 'same-origin',
            'X-Content-Type-Options': 'nosniff'
        }
    });
}
