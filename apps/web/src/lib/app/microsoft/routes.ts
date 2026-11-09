import { AccountLimitError } from '../browserAccounts';
import { cookies } from 'next/headers';
import { KnownPageLinks, KnownPages } from '../../../knownPages';
import { ApiError } from '../../comments/http';
import { appBaseUrl, requestIpBucket } from '../request';
import { appCookieOptions, getSessionSignIn, getSessionUser, startSession } from '../session';
import { safeNextPath } from '../signIn';
import { signInDestination } from '../signInDestination';
import { isMicrosoftSignInConfigured } from './config';
import { MICROSOFT_SIGN_IN_COOKIE_NAME } from './cookie';
import { MICROSOFT_LINK_TTL_SECONDS } from './link';
import { beginMicrosoftSignIn, finishMicrosoftSignIn, MICROSOFT_SIGN_IN_TTL_SECONDS, MicrosoftSignInError, type MicrosoftSignInOutcome } from './signIn';

function redirect(location: string) {
    return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

/** Sign in, with an allowlisted `microsoft` outcome and the stored return path, never OAuth parameters */
function signInUrl(baseUrl: string, outcome?: string, next?: string, addingAccount = false) {
    const url = new URL(KnownPages.AppSignIn, baseUrl);
    if (addingAccount) url.searchParams.set('add', '1');
    if (next) url.searchParams.set('next', next);
    if (outcome) url.searchParams.set('microsoft', outcome);
    return url.href;
}

function accountUrl(baseUrl: string, outcome?: string) {
    const url = new URL(KnownPageLinks.account('sign-in'), baseUrl);
    if (outcome) url.searchParams.set('microsoft', outcome);
    url.hash = 'microsoft';
    return url.href;
}

/**
 * `GET /app/sign-in/microsoft[?next=]` signs in; `?intent=link` links Microsoft to the signed-in account.
 * Cross-site and prefetch requests start nothing, like an integration's connect route.
 */
export async function startMicrosoftSignInRoute(request: Request) {
    const baseUrl = await appBaseUrl();
    const params = new URL(request.url).searchParams;
    const linking = params.get('intent') === 'link';
    const next = linking ? undefined : safeNextPath(params.get('next') ?? undefined);
    const back = (outcome?: string) => linking ? accountUrl(baseUrl, outcome) : signInUrl(baseUrl, outcome, next, params.get('add') === '1');
    const site = request.headers.get('sec-fetch-site');
    if ((site && site !== 'same-origin' && site !== 'none') || /prefetch/i.test(`${request.headers.get('purpose')} ${request.headers.get('sec-purpose')}`))
        return redirect(back());
    if (!isMicrosoftSignInConfigured())
        return redirect(back('unavailable'));

    const [user, session] = await Promise.all([getSessionUser(), getSessionSignIn()]);
    if (linking && (!user || session?.userId !== user.id))
        return redirect(signInUrl(baseUrl, undefined, KnownPageLinks.account('sign-in')));
    if (!linking && user && params.get('add') !== '1')
        return redirect(new URL(next ?? KnownPages.App, baseUrl).href);
    try {
        const started = await beginMicrosoftSignIn({ next, link: linking ? session! : undefined, baseUrl, ipBucket: await requestIpBucket() });
        (await cookies()).set(MICROSOFT_SIGN_IN_COOKIE_NAME, started.binding, appCookieOptions(MICROSOFT_SIGN_IN_TTL_SECONDS));
        return redirect(started.url);
    } catch (error) {
        return redirect(back(error instanceof ApiError && error.code === 'rate_limited' ? 'too_fast'
            : error instanceof MicrosoftSignInError && error.code === 'sign_in_again' ? 'sign_in_again' : 'failed'));
    }
}

/** `GET /app/sign-in/microsoft/callback`: Microsoft's code and state are used here and never passed on. */
export async function finishMicrosoftSignInRoute(request: Request) {
    const baseUrl = await appBaseUrl();
    const jar = await cookies();
    const binding = jar.get(MICROSOFT_SIGN_IN_COOKIE_NAME)?.value;
    // The binding works once, whatever the outcome
    jar.set(MICROSOFT_SIGN_IN_COOKIE_NAME, '', appCookieOptions(0));
    const params = new URL(request.url).searchParams;
    let outcome: MicrosoftSignInOutcome;
    try {
        outcome = await finishMicrosoftSignIn({ binding, state: params.get('state'), code: params.get('code'), error: params.get('error'),
            baseUrl, session: await getSessionSignIn() });
    } catch {
        outcome = { kind: 'problem', problem: 'failed', linking: false };
    }

    switch (outcome.kind) {
        case 'signed_in': {
            try {
                // Microsoft's addresses are never trusted (docs/microsoft-sign-in.md): this sign-in proves no email
                const proof = await startSession(outcome.userId, 'microsoft');
                return redirect(new URL(await signInDestination(outcome.userId, outcome.next ?? KnownPages.App, proof), baseUrl).href);
            } catch (error) {
                if (error instanceof AccountLimitError) return redirect(new URL(`${KnownPages.AppSignIn}?add=1&accounts=full`, baseUrl).href);
                throw error;
            }
        }
        case 'confirm_email':
            jar.set(MICROSOFT_SIGN_IN_COOKIE_NAME, outcome.binding, appCookieOptions(MICROSOFT_LINK_TTL_SECONDS));
            return redirect(new URL(KnownPages.AppSignInMicrosoftLink, baseUrl).href);
        case 'linked':
            return redirect(accountUrl(baseUrl, 'linked'));
        case 'problem':
            return redirect(outcome.linking ? accountUrl(baseUrl, outcome.problem) : signInUrl(baseUrl, outcome.problem, outcome.next, Boolean(await getSessionUser())));
    }
}
