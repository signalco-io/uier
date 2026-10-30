import { cookies } from 'next/headers';
import { KnownPages } from '../../../knownPages';
import { ApiError } from '../../comments/http';
import { appBaseUrl, requestIpBucket } from '../request';
import { appCookieOptions, getSessionSignIn, getSessionUser, startSession } from '../session';
import { safeNextPath } from '../signIn';
import { isGoogleSignInConfigured } from './config';
import { GOOGLE_SIGN_IN_COOKIE_NAME } from './cookie';
import { GOOGLE_LINK_TTL_SECONDS } from './link';
import { beginGoogleSignIn, finishGoogleSignIn, GOOGLE_SIGN_IN_TTL_SECONDS, GoogleSignInError, recentEnoughToLink,
    type GoogleSignInOutcome } from './signIn';

function redirect(location: string) {
    return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

/** Sign in, with an allowlisted `google` outcome and the stored return path, never OAuth parameters */
function signInUrl(baseUrl: string, outcome?: string, next?: string) {
    const url = new URL(KnownPages.AppSignIn, baseUrl);
    if (next) url.searchParams.set('next', next);
    if (outcome) url.searchParams.set('google', outcome);
    return url.href;
}

function accountUrl(baseUrl: string, outcome?: string) {
    const url = new URL(KnownPages.AppAccount, baseUrl);
    if (outcome) url.searchParams.set('google', outcome);
    url.hash = 'google';
    return url.href;
}

/**
 * `GET /app/sign-in/google[?next=]` signs in; `?intent=link` links Google to the signed-in account.
 * Cross-site and prefetch requests start nothing, like an integration's connect route.
 */
export async function startGoogleSignInRoute(request: Request) {
    const baseUrl = await appBaseUrl();
    const params = new URL(request.url).searchParams;
    const linking = params.get('intent') === 'link';
    const next = linking ? undefined : safeNextPath(params.get('next') ?? undefined);
    const back = (outcome?: string) => linking ? accountUrl(baseUrl, outcome) : signInUrl(baseUrl, outcome, next);
    const site = request.headers.get('sec-fetch-site');
    if ((site && site !== 'same-origin' && site !== 'none') || /prefetch/i.test(`${request.headers.get('purpose')} ${request.headers.get('sec-purpose')}`))
        return redirect(back());
    if (!isGoogleSignInConfigured())
        return redirect(back('unavailable'));

    const [user, session] = await Promise.all([getSessionUser(), getSessionSignIn()]);
    if (linking && (!user || session?.userId !== user.id))
        return redirect(signInUrl(baseUrl, undefined, KnownPages.AppAccount));
    if (!linking && user)
        return redirect(new URL(next ?? KnownPages.App, baseUrl).href);
    if (linking && !recentEnoughToLink(session!.signedInAt))
        return redirect(back('sign_in_again'));
    try {
        const started = await beginGoogleSignIn({ next, link: linking ? session! : undefined, baseUrl, ipBucket: await requestIpBucket() });
        (await cookies()).set(GOOGLE_SIGN_IN_COOKIE_NAME, started.binding, appCookieOptions(GOOGLE_SIGN_IN_TTL_SECONDS));
        return redirect(started.url);
    } catch (error) {
        return redirect(back(error instanceof ApiError && error.code === 'rate_limited' ? 'too_fast'
            : error instanceof GoogleSignInError && error.code === 'sign_in_again' ? 'sign_in_again' : 'failed'));
    }
}

/** `GET /app/sign-in/google/callback`: Google's code and state are used here and never passed on. */
export async function finishGoogleSignInRoute(request: Request) {
    const baseUrl = await appBaseUrl();
    const jar = await cookies();
    const binding = jar.get(GOOGLE_SIGN_IN_COOKIE_NAME)?.value;
    // The binding works once, whatever the outcome
    jar.set(GOOGLE_SIGN_IN_COOKIE_NAME, '', appCookieOptions(0));
    const params = new URL(request.url).searchParams;
    let outcome: GoogleSignInOutcome;
    try {
        outcome = await finishGoogleSignIn({ binding, state: params.get('state'), code: params.get('code'), error: params.get('error'),
            baseUrl, session: await getSessionSignIn() });
    } catch {
        outcome = { kind: 'problem', problem: 'failed', linking: false };
    }

    switch (outcome.kind) {
        case 'signed_in':
            await startSession(outcome.userId);
            return redirect(new URL(outcome.next ?? KnownPages.App, baseUrl).href);
        case 'confirm_email':
            jar.set(GOOGLE_SIGN_IN_COOKIE_NAME, outcome.binding, appCookieOptions(GOOGLE_LINK_TTL_SECONDS));
            return redirect(new URL(KnownPages.AppSignInGoogleLink, baseUrl).href);
        case 'linked':
            return redirect(accountUrl(baseUrl, 'linked'));
        case 'problem':
            return redirect(outcome.linking ? accountUrl(baseUrl, outcome.problem) : signInUrl(baseUrl, outcome.problem, outcome.next));
    }
}
