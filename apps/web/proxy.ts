import { NextResponse, type NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createSecureHeaders } from 'next-secure-headers';
import { combineSecureHeaders, siteExternalUrls, permissionsPolicy } from './src/lib/secureHeaders';
import { sessionContentSecurityPolicy } from './src/lib/review/sessionDocument';
import { botIdPath, proxyBotId } from './src/lib/botIdProxy';
import { cookieNames, readMigratingCookie } from './src/lib/cookieNames';
import { reviewSsoCookie } from './src/lib/app/reviewSsoCookie';

/** App pages that work signed out */
const publicAppPaths = ['/app/sign-in', '/app/invitation', '/app/connect/error'];
// OAuth routes strip transient codes and states themselves, including when the session expired.
const integrationReturns = new Set(['/app/notion/callback', '/app/github/setup', '/app/github/callback',
    '/app/linear/callback', '/app/slack/callback']);

/**
 * Signed-out visitors of an app page go to sign in, and come back to the same page afterwards
 * (`?next=`), e.g. from a link to a comment or a review link.
 */
export async function proxy(request: NextRequest) {
    const { pathname, search } = request.nextUrl;
    if (pathname.toLowerCase() === botIdPath || pathname.toLowerCase().startsWith(`${botIdPath}/`))
        return proxyBotId(request);
    const appPage = pathname === '/app' || pathname.startsWith('/app/');
    const bridge = pathname === '/review-verification' || pathname === '/review-session';
    const nonce = appPage || pathname === '/review-verification' ? randomBytes(16).toString('base64') : undefined;
    const development = process.env.NODE_ENV === 'development';
    const preview = process.env.UIER_DEPLOYMENT_ENV === 'preview';
    const policy = createSecureHeaders({
        ...combineSecureHeaders(['uier.io'], false, development, [
            ...siteExternalUrls(development, preview), ...(bridge ? [{ frameAncestors: ['*'] }] : []),
            // Project tiles show favicons from the projects' own sites (`ProjectMark`)
            ...(appPage ? [{ imgSrc: ['https:'] }] : [])
        ], nonce),
        ...(bridge ? { frameGuard: false } : {})
    });
    const csp = pathname === '/review-session'
        ? sessionContentSecurityPolicy
        : policy.find(header => header.key === 'Content-Security-Policy')!.value;
    const requestHeaders = new Headers(request.headers);
    // Never trust a client-supplied nonce or policy. Next extracts the nonce from the forwarded CSP.
    requestHeaders.delete('x-nonce');
    requestHeaders.set('Content-Security-Policy', csp);
    if (nonce) requestHeaders.set('x-nonce', nonce);
    const finish = (response: NextResponse) => {
        for (const { key, value } of policy) response.headers.set(key, value);
        response.headers.set('Content-Security-Policy', csp);
        if (bridge || nonce) response.headers.set('Cache-Control', 'no-store');
        if (!bridge) {
            response.headers.set('Permissions-Policy', permissionsPolicy);
            // The installation popup must retain its WindowProxy across the customer-site redirect.
            response.headers.set('Cross-Origin-Opener-Policy', appPage ? 'same-origin-allow-popups' : 'same-origin');
        }
        return response;
    };
    const next = () => NextResponse.next({ request: { headers: requestHeaders } });
    if (!appPage || integrationReturns.has(pathname) || publicAppPaths.some(path => pathname === path || pathname.startsWith(`${path}/`)))
        return finish(next());
    const sessionToken = readMigratingCookie(request.cookies, cookieNames.session);
    if (sessionToken) {
        const response = next();
        const companion = reviewSsoCookie(sessionToken);
        if (companion) response.cookies.set(companion);
        return finish(response);
    }

    const signIn = new URL('/app/sign-in', request.url);
    signIn.searchParams.set('next', `${pathname}${search}`);
    return finish(NextResponse.redirect(signIn));
}

export const config = {
    matcher: ['/((?!_next/static|_next/image).*)']
};
