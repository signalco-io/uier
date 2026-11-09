# Sign-in

- Sign-in emails contain a link and an eight-digit numeric code, sharing the same 15-minute request and
  atomic delete in `signIn.ts`. The code requires the signed HttpOnly `__Host-uier_sign_in_request` cookie;
  a newer request replaces the binding, and `startSession` clears it. Use `appCookieOptions` for the
  binding (SameSite=Lax, Secure outside local runtime). Store only the request-specific keyed code hash
  and compare in constant time. Never put codes in URLs, subjects or logs. Both atomic guess counters
  start at the request's creation time; reserve before comparing, invalidate on the fifth wrong guess.
  Keep the email budgets (5/address, 20/IP/hour). Invitations remain link-only. All invalid codes share
  one message; a foreign binding spends none of the original request's budget.
- **Google sign-in** (`src/lib/app/google/`, [docs/google-sign-in.md](../../../docs/google-sign-in.md)) is a hand-rolled
  OIDC code flow with PKCE. `GET /app/sign-in/google` refuses cross-site and prefetch starts and counts 30 per IP per
  hour; its 10-minute `google-sign-in` record keeps state and nonce hashes (the PKCE verifier is a keyed hash, never
  stored), bound by the signed HttpOnly `__Host-uier_google_sign_in` cookie, and the callback's delete winner alone
  exchanges the code. Never copy the code or state into a URL. The ID token comes straight from the token endpoint,
  so its claims are checked and its signature is not; check the signature first if a token ever arrives another way.
  A linked `sub` signs in (never the email, and the uier email never follows Google); unverified addresses are
  refused; only `@gmail.com` or a matching `hd` finds or creates the account and links at once. Every other
  address, new or existing, first proves its inbox with a browser-bound email code (`googleLinkId` on the sign-in
  request, `google-link` record): never create an account for it from Google alone (stale verification would
  pre-hijack it). Account links (only with a sign-in from the last 10 minutes, the passkeys' `requireRecentSignIn` on
  `sessionSignedInAt`, checked at the start and again at the callback) and unlinks; a `sub` of another user is refused.
  A link (any rule, or Account) brings Google's `picture` to an account without one; `googlePictureUrl` allows only
  `https://*.googleusercontent.com`, and a returning sign-in never imports. The button shows only in
  production and local runtime; endpoint overrides work only locally. `google-sign-in{,.api}.spec.ts` use
  `e2e/support/googleStub.ts`.
- **Microsoft sign-in** (`src/lib/app/microsoft/`, [setup and identity rules](../../../docs/microsoft-sign-in.md))
  uses a separate Entra client from Azure Boards, `common` for work/school and personal accounts, and
  only `openid email profile`. Follow the Google flow's PKCE, state/nonce hashes, signed cookie,
  one-use callback, rate limits, safe redirects and recent-session checks for Account linking.
  Verify RS256 signatures, tenant-scoped key issuer, exact v2 issuer/tenant/audience, lifetime and nonce
  with `jose`. Identity is SHA-256(issuer + newline + sub). Never identify a user by Microsoft's
  `email` or `preferred_username`; first sign-in always proves a chosen inbox with the existing email
  code flow. Only the explicit confirmation form attaches the browser's `microsoftLinkId`; a link
  opened in another browser signs in by email and links nothing. A linked identity signs in directly
  and never changes the uier email. Account can link/unlink one Microsoft identity. The callback's access token reads
  Graph's `/me/photo/$value` once (no extra scope) for an account without a picture; a pending link keeps only the
  normalized photo, never the token. Production/local
  only; endpoint overrides are local-only. Tests: `microsoft-sign-in{,.api}.spec.ts`, `microsoftStub.ts`.
- Passkeys (`src/lib/app/passkeys.ts`; `PasskeySignIn` on sign-in, `PasskeysSection` on Account) use
  `@simplewebauthn/server` and `/browser` with the RP ID and origin of `appBaseUrl()` (none on an IP
  address). Challenges are single-use records (5 minutes, atomic delete) bound by the signed HttpOnly
  `__Host-uier_passkey_challenge` cookie; every verification clears it. Adding a passkey needs a session
  signed in within 10 minutes (`iat` in the session token): a stolen older cookie cannot add one.
  The `passkey` document in `user:<id>` is the source of truth; its `passkey:<hash>` lookup is written
  first and deleted last. Keep counter checks, user verification, Ed25519/P-256/RSA only (not ML-DSA)
  and the per-IP limits. The email field has `autocomplete="email webauthn"` for passkey autofill, which
  `PasskeySignIn` starts only once the field shows (`autofill`).
  `e2e/passkeys.api.spec.ts` covers the rules; `passkeys.spec.ts` uses Chromium's virtual authenticator on
  `localhost`, with the autofill stubbed off where a test clicks the button.
- The sign-in card (`sign-in/SignInForm.tsx`, which renders the card itself) lists every option as the same outline `Button size="lg"` with
  only the method's name (Passkey, Google, Microsoft, then Email, the last resort) under "Choose how to sign
  in."; once the email is sent, the card's header becomes "Check your email" (`SignInCodeStep`, a status) and
  the code field is focused. Google and Microsoft linking keep their own header and show the status in the
  card. Each button's `aria-label` is "Sign in with ...", which the tests look up. The email option is a link
  to `?with=email` that opens the email form in place (before hydration it navigates there); "Ask for a new
  email" uses the same URL. `app.spec.ts` checks the order and `e2e/support/app.ts` `openEmailSignIn` opens it.
  `startSession(userId, method)` also sets `__Host-uier_last_sign_in` (the method's name only, one year,
  kept after sign-out); the page reads it with `getLastSignInMethod` and that option's button (`relative`)
  gets `LastUsedBadge` at its right edge and `aria-describedby` pointing at it. An email proof that linked Google or Microsoft
  counts as that provider; invitations count as email. `passkeys.spec.ts` covers it.
- `startSession(userId, method, provenEmail)` records whether the sign-in proved the account email now
  (`emailProof.ts`): the session token gets `ev`, a keyed hash of the address (never the address), and the call
  returns the proof. Email code and link, and invitation links, pass the account email; Google passes the
  outcome's `provenEmail`, set only when the ID token returns the account email where `googleIsAuthoritative`
  (a linked `sub` whose address moved, or a non-Workspace address, proves nothing); passkeys and Microsoft pass
  none. The proof counts for 10 minutes after the sign-in (`EMAIL_PROOF_SECONDS`) and only for its account and
  email (`getSessionEmailProof`). Only email domains use it.
- Every sign-in (email code and link, passkey, Google, Microsoft) continues through `signInDestination` with that
  proof: when it proved the email and a workspace offers its domain, it goes to `/app/join` first with its
  destination as `next` ([email domains](access-and-membership.md#email-domains)). Without a proof nothing is
  looked up; the lookup never fails a sign-in.
- Locally (`UIER_LOCAL=1` or `next dev`) and on previews no email is sent; pages show the link and code.
  The e2e helpers in `e2e/support/app.ts` sign in with the code. `e2e/sign-in.api.spec.ts` covers expiry,
  concurrency, binding validation, code-email safety and lifetime budgets; `app.spec.ts` and
  `project-review.spec.ts` cover browser isolation, accessibility and the toolbar's return path.

All sign-in methods share automatic own-workspace creation through `ensureOwnWorkspace` when
app context needs one. New workspaces start as **Personal**; signing in never renames an existing one.
