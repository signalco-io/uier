import { z } from 'zod';
import { extensionHandler, extensionApiOrigin } from '@/src/lib/extension/http';
import { exchangeExtensionCode, readScope } from '@/src/lib/extension/auth';
import { refreshExtensionSession, revokeExtensionSession } from '@/src/lib/extension/sessions';
import { extensionReviewContext, matchingProjects, createScope } from '@/src/lib/extension/review';
import { signToken } from '@/src/lib/app/tokens';
import { apiErrors, parseJsonBody } from '@/src/lib/comments/http';
import { assertNotBot } from '@/src/lib/comments/botProtection';
import { actorAuthorId } from '@/src/lib/review/actor';
import { extensionClient, extensionClientOrigin } from '@/src/lib/extension/config';
import { latestExtensionVersion } from '@/src/lib/extension/release';

export const dynamic = 'force-dynamic';
const handler = extensionHandler(async request => {
    const operation = new URL(request.url).pathname.split('/').at(-1);
    if (operation === 'token' && request.method === 'POST')
        return Response.json(await exchangeExtensionCode(await parseJsonBody(request, z.unknown())));
    if (operation === 'refresh' && request.method === 'POST')
        return Response.json(await refreshExtensionSession(await parseJsonBody(request, z.unknown())));
    // Public and secret-free: installed packages compare it before asking the browser for an update.
    if (operation === 'version' && request.method === 'GET') return Response.json({ version: latestExtensionVersion });
    if (operation === 'projects' && request.method === 'GET') return matchingProjects(request);
    if (operation === 'scope' && request.method === 'POST') return createScope(request);
    if (operation === 'session' && request.method === 'DELETE') {
        await revokeExtensionSession(request);
        return new Response(null, { status: 204 });
    }
    if (operation === 'verification' && request.method === 'POST') {
        // BotID runs in our own frame. No cookie or extension ID can substitute for it.
        if (request.headers.get('origin') !== extensionApiOrigin(request) || request.headers.get('sec-fetch-site') === 'cross-site') throw apiErrors.forbidden();
        const scope = readScope(request);
        const { clientId, extensionOrigin } = await parseJsonBody(request, z.object({ clientId: z.string(), extensionOrigin: z.string().optional() }));
        if (clientId !== scope.clientId) throw apiErrors.forbidden();
        const client = extensionClient(clientId);
        const origin = client && extensionClientOrigin(client, extensionOrigin);
        if (!origin || origin !== (scope.extensionOrigin ?? (client?.browser === 'chrome' ? `chrome-extension://${clientId}` : undefined))) throw apiErrors.forbidden();
        const { project, actor, siteOrigin } = await extensionReviewContext(request);
        await assertNotBot();
        return Response.json({ token: signToken('review-verification', { projectId: project.id, origin: siteOrigin, authorId: actorAuthorId(actor) }, 300), expiresAt: Date.now() + 300_000 });
    }
    throw apiErrors.notFound();
});
export const GET = handler;
export const POST = handler;
export const DELETE = handler;
export const OPTIONS = handler;
