import { NextResponse, type NextRequest } from 'next/server';
import { reviewSsoCookie } from './src/lib/app/reviewSsoCookie';

// Kept in sync with src/lib/app/session.ts. Pages verify app access; the companion cookie is
// only issued after verifying the existing session, with the same expiration.
const SESSION_COOKIE_NAME = 'uier_session';

/** App pages that work signed out */
const publicAppPaths = ['/app/sign-in', '/app/invitation'];

/**
 * Signed-out visitors of an app page go to sign in, and come back to the same page afterwards
 * (`?next=`), e.g. from a link to a comment or a review link.
 */
export function proxy(request: NextRequest) {
    const { pathname, search } = request.nextUrl;
    if (publicAppPaths.some(path => pathname === path || pathname.startsWith(`${path}/`)))
        return NextResponse.next();
    if (request.cookies.has(SESSION_COOKIE_NAME)) {
        const response = NextResponse.next();
        const companion = reviewSsoCookie(request.cookies.get(SESSION_COOKIE_NAME)!.value);
        if (companion) response.cookies.set(companion);
        return response;
    }

    const signIn = new URL('/app/sign-in', request.url);
    signIn.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(signIn);
}

export const config = {
    matcher: ['/app', '/app/:path*']
};
