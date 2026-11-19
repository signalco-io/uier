# Browser extension runtime

The verification helper streams its validated query configuration within the static-shell CSP.
It retains Next's client instrumentation so BotID initializes for the proof request, without app,
theme or analytics providers. Exact registered parent-origin checks stay in place.
See [page security](page-security.md).

`src/lib/extension` and `/api/extension` use separate revocable sessions: updated packages request
`renewable: true` for 15-minute access, rotating refresh with 30-day inactivity and one-year absolute
limits. Legacy packages retain eight-hour sessions. Refresh uses atomic session/token replacement,
hashed credentials and persisted attempt hashes: exact retries return the same derived successor,
different-attempt reuse revokes the session. Known refresh credentials can revoke after access expiry.
Project/exact-origin credentials last five minutes. `UIER_EXTENSION_CLIENT_IDS` remains the explicit
Chromium allowlist. Firefox uses `UIER_EXTENSION_CLIENTS`, a JSON array of
`{ id, browser: 'firefox', redirectUri }` registrations, disabled by default. Invalid or
duplicate registrations disable the additional clients without changing the Chromium allowlist.
Firefox's stable client is `uier@signalco.io`; register the exact HTTPS URL returned by
`browser.identity.getRedirectURL()` (including its trailing slash).
Registration grants transport only, never identity or BotID bypass. Recheck current
membership, session and addresses before calling shared review services. Keep embed CORS unchanged.
`/app/extension` is explicit consent after first-party sign-in. Approval binds the user id shown on
the page to the active session and refuses a mismatch before issuing a handoff code. Its account
boundary reloads the same consent URL after an account change; `account-consent.api.spec.ts` checks
stale-page rejection and a fresh approval. `/extension-verification` is a
nonce-protected frame for the packaged helper. Firefox sends their current extension
origin during authorization; the one-use handoff, session, access token and project scope bind that
origin. Only UUID origins in the registered browser's extension scheme are accepted. Refresh
possession can rebind the extension origin; old access and project scope tokens then fail. Retry recovery preserves the same successor and expiry.
The helper supplies `clientId` and `extensionOrigin` query parameters. Server validation sets one
exact `frame-ancestors` origin, the frame checks its actual message parent, and the verification
endpoint compares that origin with the signed scope and live session. Existing Chromium helpers
without these parameters retain their registered Chrome origins. Extension-family CORS permits
transport from syntactically valid enabled extension origins, while all identity still requires a
live token. No web origin gets that transport grant.
No app cookie reaches the worker. Read [the design and remaining gates](../../../docs/browser-extension.md).

Consent also offers explicit selection among live browser accounts. An optional validated
`siteOrigin` query hints which projects to show per account, labelled with workspace names; it
grants no access and contains no page path. Discovery shares the member-filtered matching-project
service with the bearer-only extension API, which now adds workspace labels and the current account's
display identity for the popup. Cookie-bound account selection reloads the original validated
authorization request, preserving PKCE, state and the stale-approval check. No browser session token
or another account's identity is exposed to the extension worker or reviewed page.
`extension-account-switching.spec.ts` covers desktop/mobile selection, handoff preservation and
accessibility; `extension.api.spec.ts` covers workspace labels and live project-access denial. The
extension's packaged runtime suite covers unlisted sites, same-address workspace/account choices,
cancelled sign-in and clearing the previous account's active reviews, proofs and unsent drafts.

`GET /api/extension/version` is public and secret-free: it returns `latestExtensionVersion` from
`src/lib/extension/release.ts`, the newest version on main, which `release:version` keeps equal to the
browser packages. Installed packages compare it before asking the browser for a store update
([Updates](../../../docs/browser-extension.md#updates)).

Installation uses the script/extension tabs in InstallGuide. Keep Check installation inside the
script tab; comment activity does not prove embed installation. BrowserExtensionGuide reads the
server-only distribution gate (UIER_EXTENSION_AVAILABLE=1, valid STORE_ID also in CLIENT_IDS).
Never invent a store URL or enable it without hosted/store acceptance. Its current button says
**Get for Chrome or Edge**. Both states offer **Get for Firefox** from the verified Mozilla
listing. The setup steps apply to both stores.

`public/extension-demo.html` is an unindexed, deliberately plain reviewer fixture without the
marketing layout, embed, scripts or styles. Its exact-path proxy policy denies all page resource
loads. Keep it free of customer data and sign-in secrets; reviewers create their own isolated
project. The API check preserves that boundary; the browser check scans its content directly
because the ordinary public-page accessibility helper waits for a showcase toolbar.

The public `/browser-extension` page and the `/guides/browser-extension` setup guide describe the
shared runtime and each browser's release status. Their copy follows BrowserExtensionGuide, the
listing worksheet, the popup (`packages/extension/src/popup.tsx`) and the receipts in
`docs/browser-extension.md`. Popup labels, the published Chrome store ID, store button label and
Firefox store URL and label live in `src/lib/extension/release.ts` (static pages build without the
hosted `UIER_EXTENSION_*` settings). The Chrome and Firefox buttons use the same store URLs as the
app installation guide.
Recheck both pages, and the legal pages' extension sections, when a release changes labels,
permissions, sign-in or capture, and the setup guide's pictures of the popup and the comment box
(`GuideSpecimens`, [guides](guides.md)). `browser-extension.api.spec.ts` checks the store link and
`browser-extension.spec.ts` their content.

`/browser-extension`'s cover (`BrowserExtensionCover`, beside the header on wide screens and under it
on narrow ones, like the security page's) shows Chrome, Microsoft Edge and Firefox as their official
logos on bordered tiles over a dot grid, with names written under them and fixed height per
breakpoint. The logos are unchanged copies in `public/browsers` of the `@browser-logos` packages
(github.com/alrra/browser-logos), decorative and in their own colours. Other Chromium browsers
(Brave, Vivaldi, Opera, Arc) stay off until a release is tested in them. The page lists desktop
Chrome, Microsoft Edge and Firefox with their minimum versions. The homepage's "Review your own
site" card links each browser to its official store. The setup guide shares sign-in and review
steps across desktop browsers. Safari and mobile use the script. The "Where it works" section keeps the unsupported browsers and pages. Its pictures
(`ExtensionSpecimens`) are the popup
in its "Review this site" state and the expanded review toolbar on the landing page's example site,
built from the tokens and hidden from assistive technologies, never screenshots or generated
images. Change them with `packages/extension/src/popup.tsx` and the toolbar's `CommentToolbar`.

The shared broker contract also permits `GET comments/<id>/replies/<itemId>/screenshot`. This read uses
the scoped project's current membership and parent-thread visibility through `getReviewScreenshot`;
it never dispatches to reply deletion. Image uploads use the existing verified reply POST and sanitizer.
`e2e/extension.api.spec.ts` covers the closed read-only route, image bytes, revoked membership,
browser registrations, exact callbacks, bound extension origins, refresh rebinding and exact helper
ancestors. Public installation links remain subject to each browser's publication and acceptance
gates; local browser builds do not announce new store availability.

`POST /api/extension/projects` (`createSiteProject` in `src/lib/extension/review.ts`) creates a project for a
site no project includes, from the popup. It takes the worker's access token (never a review scope or a refresh
credential), an exact origin, a name, a workspace id and an attempt. In order:

- **Capability.** The session must hold `create-projects` (`sessions.ts`, `hasExtensionCapability`). Authorization
  asks for it with `capability=create-projects`, `/app/extension` names it in its own list item, the one-use handoff
  stores it and the exchange copies it to the session from the handoff alone, never from the exchange body. Refresh
  keeps the session record, so it neither adds nor drops it. Sessions issued before the capability existed have none:
  they review as before and get 403 here. A new capability needs its consent line, in every app language.
- **Permission.** The person must be a stored admin of that workspace, and uier's own workspace is never accepted
  (`mayCreateProjects`): the same rule as the app's Create project. A missing workspace, a removed member and a
  commenter get the same 403.
- **Replay.** `attemptedProject` finds the project an earlier request with this attempt created; it is returned
  without counting against the budget.
- **Budget.** `siteProjectsLimit`: 30 new projects an hour per account, 429 with `Retry-After` beyond it.
- **Creation.** The app's `createProject` with the attempt ([projects](projects.md)), so address and name
  validation, the invited-only default, the public id and the client record are the app's. Keep new creation rules
  in `createProject` so both paths get them.

`GET projects` adds `workspaces` (id and name of each workspace the account may create in, oldest membership
first) beside `canSetUp`, which installed packages still read; the list is a label and grants nothing. A session
without the capability gets an empty list and `approveCreate: true` when the account has such a workspace.
`extension.api.spec.ts` covers the capability (legacy, renewable and renewed sessions, an exchange that asks for
it), the roles, stale and removed memberships, credentials, validation, replay and concurrent requests of one
attempt, the budget and the route; the packaged runtime suite reads the consent line, moves the tab between the form
and its submit, sends one submission twice and reviews with the created project.

Workflow discovery uses the allowlisted `GET statuses` operation and the same member-only handler as the embed review API. Guests cannot retrieve workflow names, descriptions or defaults.

The cross-tab consent regression asserts the complete “Continue as” approval identity, since
`c45a996a` (#722) also lists account names in Signed-in accounts. It checks both account switches
and the final handoff, so a retained inactive account cannot satisfy the approval assertion.
