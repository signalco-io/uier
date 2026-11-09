# Active account and review sign-in

The app can retain up to five independently signed account sessions; its active session alone
supplies the review companion. `ProjectGate.loadReviewInfo` asks the bounded background frame on
foreground identity checks even when a review token is already stored. Concurrent checks share
the same attempt; ordinary bootstrap remains one attempt. Exact frame source, origin and request
nonce are required. Native extension adapters keep their independent identity lifecycle.

A valid handoff replaces the old review token. `X-Uier-Active-Account` on the same-origin SSO response
also tells the bridge when a known active account lacks project access, or an explicit final sign-out
marker exists. In either case the old token is cleared before asking for project info. Reviewer-scope
changes use the existing cache clearing and keyed viewer tree so another account's comments and
drafts are not reused. The marker has its own signed purpose and authorizes no account.

A blocked/failed frame or missing cookie is not evidence of sign-out: preserve the authenticated
review-link fallback and its original token lifetime. No storage-access prompt or popup is opened.
Toolbar Sign out still disables automatic sign-in for this project/site until an explicit successful
review-link exchange. The app's account switch does not override that choice.

`apps/web/e2e/account-switching.spec.ts` covers selection, loss of access and final sign-out on
foreground; `review-sso.spec.ts` keeps the blocked-cookie, origin and nonce boundary coverage.
