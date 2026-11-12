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
The changed documents already carry today's 12 November 2026 effective date. Unchanged policies keep
their existing dates. `legal.spec.ts` guards the project/privacy distinction, identity fallback,
analytics status and erasure limitations.
