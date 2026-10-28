import { cookies } from 'next/headers';
import { getAppContext, WORKSPACE_COOKIE_NAME } from '../app/context';
import { appBaseUrl } from '../app/request';
import { getProject, isProjectId } from '../app/projects';
import { getMember } from '../app/workspaces';
import { KnownPageLinks } from '../../knownPages';
import { isLocalRuntime } from '../comments/environment';
import { PUBLIC_PROJECT_ID } from '../comments/publicProject';
import type { IntegrationProviderId } from './model';

type BeginInput = { userId: string; workspaceId: string; projectId: string; baseUrl: string };
type FinishInput = { userId: string; state: unknown; code?: string; error?: string; baseUrl: string };
type FinishedConnection = { workspaceId: string; projectId: string; status: 'connected' | 'denied' | 'failed'; setupReceipt?: string };

function redirect(location: string) {
    return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

function invalidConnection() {
    return new Response('This connection link is not valid. Start again from the project settings.', {
        status: 400, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' }
    });
}

export function integrationConnectRoute(provider: IntegrationProviderId, begin: (input: BeginInput) => Promise<string>) {
    return async (request: Request) => {
        const baseUrl = await appBaseUrl();
        const context = await getAppContext();
        if (!context) return redirect(new URL('/app/sign-in?next=/app', baseUrl).href);
        const projectId = new URL(request.url).searchParams.get('project');
        if (!isProjectId(projectId) || projectId === PUBLIC_PROJECT_ID || !context.isAdmin
            || !await getProject(context.workspace.id, projectId)) return new Response(null, { status: 404 });
        const settings = new URL(KnownPageLinks.projectSettings(projectId), baseUrl);
        const site = request.headers.get('sec-fetch-site');
        if ((site && site !== 'same-origin' && site !== 'none') || /prefetch/i.test(`${request.headers.get('purpose')} ${request.headers.get('sec-purpose')}`))
            return redirect(settings.href);
        try {
            return redirect(await begin({ userId: context.user.id, workspaceId: context.workspace.id, projectId, baseUrl }));
        } catch {
            settings.searchParams.set(provider, 'unavailable');
            settings.hash = provider;
            return redirect(settings.href);
        }
    };
}

export function integrationCallbackRoute(provider: IntegrationProviderId, finish: (input: FinishInput) => Promise<FinishedConnection>) {
    return async (request: Request) => {
        const baseUrl = await appBaseUrl();
        const context = await getAppContext();
        // OAuth codes/state are never copied into a sign-in document or its return URL.
        if (!context) return redirect(new URL('/app/sign-in?next=/app', baseUrl).href);
        const params = new URL(request.url).searchParams;
        try {
            const result = await finish({ userId: context.user.id, state: params.get('state'), code: params.get('code') ?? undefined,
                error: params.get('error') ?? undefined, baseUrl });
            if (!isProjectId(result.projectId) || result.projectId === PUBLIC_PROJECT_ID
                || (await getMember(result.workspaceId, context.user.id))?.role !== 'admin'
                || !await getProject(result.workspaceId, result.projectId)) return invalidConnection();
            (await cookies()).set(WORKSPACE_COOKIE_NAME, result.workspaceId, {
                httpOnly: true, sameSite: 'lax', path: '/', maxAge: 365 * 24 * 3600, secure: !isLocalRuntime()
            });
            const settings = new URL(KnownPageLinks.projectSettings(result.projectId), baseUrl);
            settings.searchParams.set(provider, result.status);
            if (provider === 'github' && result.setupReceipt) settings.searchParams.set('githubSetup', result.setupReceipt);
            settings.hash = provider;
            return redirect(settings.href);
        } catch { return invalidConnection(); }
    };
}
