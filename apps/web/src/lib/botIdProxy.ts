import type { NextRequest } from 'next/server';
import { permissionsPolicy } from './secureHeaders';
import { isLocalRuntime } from './comments/environment';

export const botIdPath = '/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3';
export const botIdHeaders = [
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Permissions-Policy', value: permissionsPolicy },
    { key: 'X-XSS-Protection', value: '0' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    { key: 'Content-Security-Policy', value: "default-src 'none'; script-src 'self'; connect-src 'self'; worker-src 'self' blob:; img-src 'self' data:; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'" }
];

/** Next's external rewrite proxy discards configured response headers. Apply them after fetch. */
export async function proxyBotId(request: NextRequest) {
    const suffix = request.nextUrl.pathname.slice(botIdPath.length);
    const base = isLocalRuntime() && request.nextUrl.searchParams.has('uier-header-fixture') && process.env.OVERRIDE_BOTID_SERVER_URL
        ? process.env.OVERRIDE_BOTID_SERVER_URL : 'https://api.vercel.com/bot-protection';
    const target = `${base}${suffix === '/a-4-a/c.js' ? '/v1/challenge' : `/v1/proxy${suffix}`}${request.nextUrl.search}`;
    const headers = new Headers(request.headers);
    // Match Next's external proxy: BotID must see the application host, not api.vercel.com.
    headers.set('x-forwarded-host', request.headers.get('host') || request.nextUrl.host);
    headers.delete('host');
    headers.delete('connection');
    headers.delete('accept-encoding');
    const init: RequestInit & { duplex: 'half' } = {
        method: request.method, headers, redirect: 'manual', cache: 'no-store', duplex: 'half',
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body
    };
    const upstream = await fetch(target, init);
    const responseHeaders = new Headers(upstream.headers);
    // fetch decodes the body; the upstream encoded length is no longer applicable.
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');
    for (const { key, value } of botIdHeaders) responseHeaders.set(key, value);
    responseHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
