# Legal documents

`/legal/privacy-policy`, `/legal/terms-of-service`, `/legal/cookie-policy`,
`/legal/acceptable-use-policy` and `/legal/sla` describe what the site actually does: what the
comments API stores, the `__Host-uier_visitor` cookie, rate limits, BotID, Vercel Web Analytics, where data
is stored and for how long. When you change any of that (a new cookie or storage key, a new
third party, a different retention), update the matching document and its effective date in the
same pull request. The token creation/revocation counter contains no token metadata and expires
90 days after its last update; creation audit receipts expire after 30 days. The SLA states that there are no service commitments; do not add uptime targets
or credits before they are decided. `e2e/legal.spec.ts` checks each document, the legal navigation
and the footer links.

Public contact addresses come from `brand.contact`: privacy requests use privacy@uier.io and
general questions use contact@uier.io. The privacy, cookie, terms and acceptable-use policies
have an effective date of 11 November 2026 for this contact update. Keep the displayed addresses
and mailto links aligned with the brand constants.
