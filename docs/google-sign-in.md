# Google sign-in

"Continue with Google" on the app's sign-in card signs people in with their Google account, next to
the email code and link. Email sign-in always stays available. A signed-in person can link or unlink
Google under Account → Google account.

The flow is OpenID Connect's authorization code flow with PKCE, written in `apps/web/src/lib/app/google/`
like the integrations' OAuth (no auth framework):

| File | What |
| --- | --- |
| `config.ts` | client id and secret, endpoints (overridable only in local runtime), where the button shows, the redirect URI |
| `signIn.ts` | `beginGoogleSignIn`, `finishGoogleSignIn` (the linking rules), the ID token checks |
| `identity.ts` | the `sub` → user claim and the user's linked account: link, unlink, look up |
| `link.ts` | a Google account waiting for an email code before it is linked |
| `cookie.ts` | the `__Host-uier_google_sign_in` browser binding |
| `routes.ts` | `GET /app/sign-in/google` and `GET /app/sign-in/google/callback` |

## The flow

1. `GET /app/sign-in/google?next=<app path>` (or `?intent=link` from Account) refuses cross-site
   (`Sec-Fetch-Site` other than `same-origin` or `none`) and prefetch requests, like an integration's
   connect route, and counts 30 starts per IP address per hour. It stores a `google-sign-in` record
   for 10 minutes: SHA-256 hashes of a random `state` and `nonce`, `safeNextPath(next)`, and for
   linking the signed-in user's id. The PKCE verifier is never stored: it is
   `keyedHash('google-sign-in-pkce', id:state)` under the server secret, so only the server, with the
   state Google sends back, can recreate it. The browser gets a signed HttpOnly SameSite=Lax cookie
   that holds only the record id (`appCookieOptions`, `__Host-` and Secure outside local runtime).
2. Google's authorization endpoint gets `scope=openid email profile`, the state, the nonce, the S256
   challenge and `prompt=select_account`.
3. `GET /app/sign-in/google/callback` reads and clears the binding cookie. The record must exist,
   match the state's hash and still be inside its 10 minutes; a delete uses it up, and only the
   winner of that delete exchanges the code. A missing or foreign binding, a replayed callback and a
   wrong state all end on `/app/sign-in?google=expired` without calling Google. The code and state
   are never copied into a return URL; outcomes are allowlisted words in a `google` parameter.
4. The code is exchanged at Google's token endpoint with the client secret and the verifier
   (`redirect: 'error'`, 10 seconds). The ID token's `iss` (`https://accounts.google.com` or
   `accounts.google.com`), `aud` and `azp` (the client id), `exp`, `iat` (issued during the flow, with
   five minutes of clock skew) and `nonce` (its hash) are checked. Nothing from the token response is
   stored or logged; the access token is discarded.
5. Signing in ends with `startSession(user.id)`, which also clears the Google binding. Staff and
   memberships keep working from `user.email`, as for email sign-in.

### Why the ID token signature is not checked

The ID token comes straight from Google's token endpoint over TLS, in a request authenticated with
the client secret, and uier never passes it on. OpenID Connect Core 1.0, section 3.1.3.7, step 6
allows TLS server validation in place of the signature check in exactly this case, and
[Google's OpenID Connect guide](https://developers.google.com/identity/openid-connect/openid-connect)
says the same. Checking it against Google's JWKS would add a key fetch, caching and rotation
failures without protecting against anything TLS does not already cover. The token endpoint is fixed
to `https://oauth2.googleapis.com/token`; the override exists only in local runtime for the tests.
If the token ever comes from anywhere else (a browser, another service), its signature must be
checked first.

## Linking rules

`finishGoogleSignIn` decides who signs in:

1. **The `sub` is linked:** sign in as that user. After linking, sign-in matches on `sub` only,
   never on the email, and a changed Google address never changes the uier email (Account shows the
   latest verified Google address).
2. **`email_verified` is false:** refused (`google=unverified`), pointing to email sign-in.
3. **Google is authoritative for the address:** an `@gmail.com` address, or an `hd` claim equal to
   the address's domain (Google Workspace). The account is found or created with
   `findOrCreateUserWithStatus` (a new account takes the Google `name`, when valid, as its display
   name) and linked at once.
4. **Any other verified address**, whether or not a uier account has it: the inbox is proven once
   with the usual email code before anything is created or linked. Google's verification of such an
   address can be stale (a former employee, a re-registered domain); an account created for it at
   once, already linked, would wait for the address's real owner, who would then sign in by email
   into an account a stranger reaches through Google. The verified Google account waits in a
   `google-link` record for 15 minutes, bound to the browser by the same cookie, and
   `/app/sign-in/google/link` asks the person to confirm the address. The page does not say whether
   an account exists. That sign-in request carries the link's id (`googleLinkId`); consuming it
   creates the account if needed (`findOrCreateUser`, as for email sign-in) and links the Google
   account only when the request's browser binding matches: the code always, the emailed link only
   in the browser that asked. The link opened anywhere else signs in by email and links nothing.
   The email says that using it also links a Google account.
5. **Account:** a signed-in person links Google (`?intent=link`) only with a sign-in from the last
   10 minutes, like adding a passkey: a stolen session cookie could otherwise attach a Google account
   that outlives the 30-day session and survives sign-out. The start route checks it, and the
   callback checks it again against the request's creation time, in the session that started it.
   An older sign-in gets "Sign in again" on Account, which signs out and returns there after signing
   in. The callback links to the user who started it, whatever the Google address is. A `sub` linked
   to another user is refused (`taken`), and so is a second Google account (`other_account`).
   Unlinking is always allowed.

The sign-in time is `sessionSignedInAt` in `sessionIdentity.ts`: sessions are never re-signed, so it
is the token's expiry minus `SESSION_TTL_SECONDS`.

If the Google account was linked elsewhere while an email proof was pending, the person is still
signed in by email and lands on Account with `google=taken`.

## What is stored

| Document (`type`) | `pk` | `id` | Lifetime |
| --- | --- | --- | --- |
| `google-sign-in`: state and nonce hashes, return path, linking user | `google-sign-in:<id>` | 64 random hex | 10 minutes, used up by the callback |
| `google-link`: `sub` and the verified address waiting for an email code | `google-link:<id>` | 64 random hex | 15 minutes, used up when linked |
| `user-identity`: the unique `sub` → user claim | `identity:google:<sub>` | Google's `sub` | until unlinked |
| `google-account`: the user's linked `sub`, its address for display, when it was linked | `user:<userId>` | `google` | until unlinked |

A link writes the user's record first and then the claim, like `findOrCreateUser`. Unlinking
deletes the user's record first, so sign-in (which needs both to agree) stops even if deleting the
claim fails; such a leftover claim is replaced by the next link. Google's picture, tokens and other
profile fields are not stored.

## Where the button shows

Only in production and local runtime, when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.
Previews never show it: Google accepts only registered redirect URIs, and every preview has its own
address. The redirect URI is `appBaseUrl()` + `/app/sign-in/google/callback`, HTTPS outside local
runtime. Account keeps showing a linked Google account (with Unlink) wherever the button is off.

The button follows [Google's branding guidelines](https://developers.google.com/identity/branding-guidelines):
"Continue with Google", the standard "G", Google Sans Medium 14/20 (self-hosted by `next/font`) and
Google's light and dark theme colours. It is the one place the app leaves Geist and the brand tokens.

## Create the Google OAuth client

An owner does this once in the [Google Cloud console](https://console.cloud.google.com/), in a
project owned by the uier organization:

1. **Google Auth Platform → Branding.** App name `uier`, a support email, the logo from
   `packages/brand/assets`, the home page `https://uier.io`, the privacy policy
   `https://uier.io/legal/privacy-policy`, the terms `https://uier.io/legal/terms-of-service`, and the
   authorized domain `uier.io`.
2. **Audience.** User type *External*. Publish the app (*In production*); while it is in testing only
   listed test users can sign in. Showing the logo on the consent screen needs Google's brand verification.
3. **Data access.** Add only `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile`.
   They are non-sensitive scopes, so no security assessment is needed.
4. **Clients → Create client.** Type *Web application*, name `uier production`. Leave *Authorized
   JavaScript origins* empty (the flow runs on the server). *Authorized redirect URIs*:
   `https://uier.io/app/sign-in/google/callback`. Copy the client id and secret when they are shown.
5. Add them to the `UIER_INTEGRATION_ENV` repository secret as `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`, keeping the existing entries (see
   [production credentials](integration-setup.md#production-credentials)). CI applies them with Pulumi
   as production-only Vercel variables (`infra/src/integrations.ts`); never run `pulumi up` locally.
   Endpoint overrides are not accepted there.

For local development, create a separate client (`uier local`) with the redirect URI
`http://localhost:4004/app/sign-in/google/callback` and put its id and secret in `apps/web/.env.local`.
Never copy the production client to a local or preview environment.

## Tests

`e2e/support/googleStub.ts` stands in for Google's authorization and token endpoints (on `PORT + 6000`
in `playwright.config.ts`, which points `GOOGLE_OAUTH_AUTHORIZE_URL`, `GOOGLE_OAUTH_TOKEN_URL` and
`GOOGLE_OAUTH_ISSUER` at it; these overrides work only in local runtime). `e2e/google-sign-in.api.spec.ts`
covers every linking rule, state, nonce and PKCE replay and expiry, missing and foreign browser
bindings, a `sub` linked to another user, the ID token checks, return paths, rate limits and the
routes, including the recent sign-in rule for linking. `e2e/google-sign-in.spec.ts` (full suite) signs
in through the stub with a non-Gmail address, confirms it by email code, unlinks on Account and
cancels a consent.
