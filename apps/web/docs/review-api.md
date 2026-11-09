# Review API and comment records

- Toolbar point anchors can use the single `#uier-toolbar>>>` boundary on uier's own pages, in the
  anchor, in `layer.opener` (a thread's pin or a button of the pill) and in `layer.nested` (the
  toolbar buttons that open nested toolbar layers, outside in; only with a toolbar opener, up to 7). `comments/validation.ts`
  retains the restricted CSS grammar after it; the toolbar resolves those anchors only when the page
  and configured API share an origin. The review API refuses them from a project's sites
  (`review/toolbarAnchors.ts`, on create and reattach, whenever `siteOrigin` is set): only uier's own
  pages review the toolbar. `e2e/toolbar-review.spec.ts` covers the review UI, `embed.spec.ts` and
  `toolbar-anchors.api.spec.ts` the refusal, and `comments.api.spec.ts` rejects arbitrary shadow
  boundaries/selectors. Toolbar side: `packages/toolbar/docs/toolbar-review.md`.

- `reviewSsoCookie.ts` owns the HttpOnly/Secure/SameSite=None companion, restricted to `/api/review`.
  Sign-in and first-party app requests seed it with no longer lifetime than the SameSite=Lax app session;
  sign-out expires both. It cannot authenticate app routes. Browser-blocked handoffs silently retain the
  explicit review-link fallback. Comment writes continue to require the existing browser verification.

- Message edits through the review API compare `expectedText` before changing a thread item; author/admin
  permission checks and etag retries preserve concurrent replies. `editedAt` is shown in the toolbar and app.
  The app's in-place reply edit (`editCommentReplyAction`) uses the same `editProjectCommentItem`.
- Saved image replacements use `POST .../comments/<id>/screenshot` with shared screenshot validation,
  the daily image budget and `expectedRevision`. `replaceScreenshot.ts` checks visibility/edit rights
  on each attempt; stores upload immutable Blob bytes, then atomically swap comment metadata and
  image references under the comment etag. Never delete a proposed blob on an uncertain Cosmos result.
  Never delete the original before this transaction succeeds. Public authors and project authors/admins
  can replace evidence; readers retain the existing comment visibility rules. The screenshot replacement
  API/browser tests cover failure, reload, redaction, private visibility and deletion.
- A new comment's `screenshot` is either the automatic capture or the reviewer's own attached image
  (toolbar Attach image or paste). The API cannot tell them apart and needs not: `comments/validation.ts`
  parses (`parseScreenshot`) and re-encodes (`sanitizeScreenshot`) every one under the same limits and image budget.
- Reproduction context is allowlisted by `src/lib/comments/reproduction.ts`: only authorized project members
  get it in the review DTO or app cards. Public/guest `device` DTOs stay limited to size and viewport. Capture time
  and viewport belong to the original feedback start; page links validate the project's origin and retain only stored approved page state.
- `@uier/toolbar/page-state` is the shared pure URL contract. Projects opt in through Review → Advanced (`ProjectReviewForm`); the
  review API filters submitted paths using that policy and marks new records `pageStateVersion: 1`. Store queries
  match v1 keys exactly; the legacy query-string prefix fallback must never merge v1 views into a base page.
  `sourcePath` keeps the page's trailing slashes for links: `newSourcePath` stores it only for the same page key,
  and every navigable link (app cards, member redirects, reproduction, notifications, Copy issue) goes through
  `commentSourcePath`, which falls back to the key. Never group, query or authorize by it.

Assignment eligibility lives in `review/participants.ts` and is rechecked inside optimistic
comment mutations. Mentions store selected account ids with UTF-16 text ranges; review DTOs
expose identity metadata only to members. App and toolbar must share these checks.
