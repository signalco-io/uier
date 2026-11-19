# Legal documents

`/legal/privacy-policy`, `/legal/terms-of-service`, `/legal/cookie-policy`,
`/legal/acceptable-use-policy` and `/legal/sla` describe what the site actually does: what the
comments API stores, the `__Host-uier_visitor` cookie and `X-Uier-Visitor` fallback, rate limits, BotID,
disabled analytics collection, where data
is stored and for how long. When you change any of that (a new cookie or storage key, a new
third party, a different retention), update the matching document and its effective date in the
same pull request. The token creation/revocation counter contains no token metadata and expires
90 days after its last update; creation audit receipts expire after 30 days. The SLA states that there are no service commitments; do not add uptime targets
or credits before they are decided. `e2e/legal.spec.ts` checks each document, the legal navigation
and the footer links.

Public contact addresses come from `brand.contact`: privacy requests use privacy@uier.io and
general questions use contact@uier.io. The privacy, cookie, terms and acceptable-use policies
have an effective date of 12 November 2026 for this contact update. Keep the displayed addresses
and mailto links aligned with the brand constants.

The terms cover configured customer projects, invited/guest access and coding tools. Distinguish
public guest feedback from signed-in feedback private to its author and the uier team. Both uier
feedback projects use the 90-day thread TTL; customer project threads stay until deleted. Individual
message removal can preserve other replies; authorized whole-thread deletion removes the discussion.
Done and Archive do not erase data. Keep cleanup retries, seven-day backup copies and outside
recipients' retention explicit. Correcting these disclosures does not change product behavior.

Issue [#289](https://github.com/signalco-io/uier/issues/289) requires owner review of its final legal
wording before merge. Prepare the tested text for review; do not infer that passing checks approve it.
The privacy policy's 13 November 2026 update describes explicit screen recordings, browser-memory
drafts, private video storage, access and cleanup. Its changed wording needs the same owner review
before merge. Other policies retain their existing dates. `legal.spec.ts` guards the project/privacy distinction, identity fallback,
analytics status and erasure limitations.

The privacy policy's 14 November 2026 update also describes optional workspace Notion project imports
and the identifier-only associations retained to prevent recreation after manual override, deletion
or transfer. This wording remains subject to the owner review above before merge.

The cookie policy's 19 November 2026 update lists `uier-app`, the app's IndexedDB copy of the sidebar
([local shell cache](app-shell.md#local-shell-cache)): what it holds, that it never grants access and that signing out
removes it. Change that entry with the cache.

The privacy policy's 16 November 2026 update describes the optional Slack file sharing: screenshot and
recording files reach Slack only after an admin allows file uploads and turns the option on, are posted
in the message's thread, and are removed when replaced, deleted or made private. The recordings section
no longer says recordings are never copied to connected services. This wording needs the same owner
review before merge.

The privacy policy and terms of service were updated on 19 November 2026 to describe self-service account deletion in Account →
General, workspace handoff, retention of contributed feedback and history, and the one email that
confirms the deletion to the account's address. The existing owner review applies before merge.

The privacy policy's 19 November 2026 update describes the composer's screenshot thumbnail ([uier #476](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2F&comment=comment_MHq-BrZmONnqI7ugzvoOX)):
the comment box shows the automatic screenshot as a thumbnail that can be previewed, and removing it
(turning off Attach screenshot in browser extension 0.1.9 and earlier) omits only the automatic
screenshot; an image or recording the person attaches is still sent. This wording needs the same owner
review before merge.
