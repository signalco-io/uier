import { NextResponse, type NextRequest } from 'next/server';

// Kept in sync with src/lib/app/session.ts (the proxy only checks that the cookie exists; pages
// verify it and send invalid sessions to sign in as well)
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
    if (request.cookies.has(SESSION_COOKIE_NAME))
        return NextResponse.next();

    const signIn = new URL('/app/sign-in', request.url);
    signIn.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(signIn);
}

export const config = {
    matcher: ['/app', '/app/:path*']
};
