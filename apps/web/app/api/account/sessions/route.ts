import { NextRequest, NextResponse } from 'next/server.js';
import { z } from 'zod';
import { removeBrowserAccount, switchBrowserAccount } from '@/src/lib/app/browserAccounts';
import { assertAppOrigin } from '@/src/lib/app/avatarUpload';
import { safeNextPath } from '@/src/lib/app/signIn';
import { requestSessionUser } from '@/src/lib/app/sessionIdentity';
import { UserFacingError } from '@/src/lib/app/actionErrors';
import { apiErrors, errorResponse, parseJsonBody } from '@/src/lib/comments/http';
import { projectLinkAccounts, projectLinkSwitchPath } from '@/src/lib/app/projectLinkAccounts';
import { cookieName, cookieNames } from '@/src/lib/cookieNames';
import { appCookieOptions } from '@/src/lib/app/appCookies';

const inputSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('switch'), userId: z.string().min(1).max(100), next: z.string().max(2048).optional() }).strict(),
    z.object({ action: z.literal('open-project-link'), next: z.string().max(2048) }).strict(),
    z.object({ action: z.literal('sign-out') }).strict(),
    z.object({ action: z.literal('sign-out-all') }).strict()
]);
const privateHeaders = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };

/** Identity check for an already rendered app tab. No parked account information is exposed. */
export async function GET(request: NextRequest) {
    if (request.headers.get('sec-fetch-site') === 'cross-site')
        return new Response(null, { status: 403, headers: privateHeaders });
    const active = await requestSessionUser(request);
    return Response.json({ userId: active?.id ?? null }, { headers: privateHeaders });
}

/** Same-origin, cookie-bound account selection. The submitted id alone grants no authority. */
export async function POST(request: NextRequest) {
    try {
        assertAppOrigin(request);
        const input = await parseJsonBody(request, inputSchema);
        const response = new NextResponse(null, { headers: privateHeaders });
        let next = '/app';
        const jar = { get: (name: string) => request.cookies.get(name), set: response.cookies.set.bind(response.cookies) };
        if (input.action === 'open-project-link') {
            next = safeNextPath(input.next) ?? '/app/projects';
            // Recheck live credentials and resource permissions at the mutation boundary. A
            // prefetched page never changes accounts; only this same-origin POST can select one.
            const choices = await projectLinkAccounts(jar, next);
            if (choices.length > 1) next = projectLinkSwitchPath(next);
            else if (choices.length === 1) {
                const choice = choices[0]!;
                await switchBrowserAccount(jar, choice.userId);
                response.cookies.set(cookieName(cookieNames.workspace), choice.workspaceId, appCookieOptions(cookieNames.workspace.lifetime));
            }
        }
        else if (input.action === 'switch') {
            await switchBrowserAccount(jar, input.userId);
            next = safeNextPath(input.next) ?? '/app';
        }
        else if (!await removeBrowserAccount(jar, input.action === 'sign-out-all')) next = '/app/sign-in';
        response.headers.set('Content-Type', 'application/json');
        return new NextResponse(JSON.stringify({ next }), { headers: response.headers });
    } catch (error) {
        const response = errorResponse(error instanceof UserFacingError ? apiErrors.invalidRequest(error.message) : error);
        for (const [name, value] of Object.entries(privateHeaders)) response.headers.set(name, value);
        return response;
    }
}
