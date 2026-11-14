import { getAppContext } from '@/src/lib/app/context';
import { appBaseUrl } from '@/src/lib/app/request';
import { beginNotionProjectsConnect } from '@/src/lib/integrations/notion/projects/connection';
import { KnownPages } from '@/src/knownPages';

export async function GET(request: Request) {
    const baseUrl = await appBaseUrl();
    const context = await getAppContext();
    const redirect = (url: string) => new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store' } });
    if (!context) return redirect(new URL('/app/sign-in?next=/app', baseUrl).href);
    if (!context.isAdmin) return new Response(null, { status: 404 });
    const settings = new URL(`${KnownPages.AppSettings}#notion-projects`, baseUrl);
    const site = request.headers.get('sec-fetch-site');
    if ((site && site !== 'same-origin' && site !== 'none') || /prefetch/i.test(`${request.headers.get('purpose')} ${request.headers.get('sec-purpose')}`)) return redirect(settings.href);
    try { return redirect(await beginNotionProjectsConnect({ userId: context.user.id, workspaceId: context.workspace.id, baseUrl })); }
    catch { settings.searchParams.set('notion', 'unavailable'); return redirect(settings.href); }
}
