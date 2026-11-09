import { extensionFrameAncestors } from './src/lib/extension/config';
import { NextResponse, type NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createSecureHeaders } from 'next-secure-headers';
import { combineSecureHeaders, siteExternalUrls, permissionsPolicy, siteIconContentSecurityPolicy, siteIconPath } from './src/lib/secureHeaders';
import { sessionContentSecurityPolicy } from './src/lib/review/sessionDocument';
import { botIdPath, proxyBotId } from './src/lib/botIdProxy';
import { cookieNames, readMigratingCookie } from './src/lib/cookieNames';
import { reviewSsoCookie } from './src/lib/app/reviewSsoCookie';
import { KnownPages } from './src/knownPages';

/** App pages that work signed out */
const publicAppPaths = ['/app/sign-in', '/app/invitation', '/app/connect/error'];
// OAuth routes strip transient codes and states themselves, including when the session expired.
const integrationReturns = new Set(['/app/notion/callback', '/app/github/setup', '/app/github/callback',
    '/app/linear/callback', '/app/slack/callback', '/app/azure-devops/callback']);

/**
 * Signed-out visitors of an app page go to sign in, and come back to the same page afterwards
 * (`?next=`), e.g. from a link to a comment or a review link.
 */
export async function proxy(request: NextRequest) {
    const { pathname, search } = request.nextUrl;
    if (pathname.toLowerCase() === botIdPath || pathname.toLowerCase().startsWith(`${botIdPath}/`))
        return proxyBotId(request);
    const appPage = pathname === '/app' || pathname.startsWith('/app/');
    const extensionDemo = pathname === KnownPages.ExtensionDemo;
    const extensionCallback = pathname === '/extension-callback';
    const bridge = pathname === '/review-verification' || pathname === '/review-session' || pathname === '/extension-verification';
    const nonce = appPage || extensionCallback || (pathname === '/review-verification' || pathname === '/extension-verification') ? randomBytes(16).toString('base64') : undefined;
    const development = process.env.NODE_ENV === 'development';
    const preview = process.env.UIER_DEPLOYMENT_ENV === 'preview';
    const policy = createSecureHeaders({
        ...combineSecureHeaders(['uier.io'], false, development, [
            { connectSrc: [request.nextUrl.origin.replace(/^http/, 'ws')] },
            ...siteExternalUrls(development, preview), ...(bridge ? [{ frameAncestors: pathname === '/extension-verification' ? extensionFrameAncestors(request.nextUrl) : ['*'] }] : [])
        ], nonce),
        ...(bridge ? { frameGuard: false } : {})
    });
    // A plain, unembedded reviewer fixture deliberately denies page execution and resource loads.
    const csp = extensionDemo
        ? "default-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; img-src 'none'; font-src 'none'; style-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        : pathname === '/review-session'
        ? sessionContentSecurityPolicy
        : siteIconPath.test(pathname)
        ? siteIconContentSecurityPolicy
        : policy.find(header => header.key === 'Content-Security-Policy')!.value;
    const requestHeaders = new Headers(request.headers);
    // Never trust a client-supplied nonce or policy. Next extracts the nonce from the forwarded CSP.
    requestHeaders.delete('x-nonce');
    requestHeaders.set('Content-Security-Policy', csp);
    if (nonce) requestHeaders.set('x-nonce', nonce);
    const finish = (response: NextResponse) => {
        for (const { key, value } of policy) response.headers.set(key, value);
        response.headers.set('Content-Security-Policy', csp);
        if (bridge || nonce || extensionDemo) response.headers.set('Cache-Control', 'no-store');
        if (extensionCallback) {
            response.headers.set('Referrer-Policy', 'no-referrer');
            response.headers.set('X-Robots-Tag', 'noindex, nofollow');
        }
        if (extensionDemo) response.headers.set('X-Robots-Tag', 'noindex');
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
