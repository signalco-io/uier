# Footer

Every public page gets `SiteFooter` from the marketing layout; pages do not render their own.
Contact and social destinations come from `brand.contact` / `brand.social` in `@uier/brand`
(uier.io contact addresses), routes from `src/knownPages.ts`. The footer links
GitHub but not signalco's X account; `brand.social.x` stays for the structured data (`sameAs`).
Labels are sentence case. `e2e/footer.spec.ts` checks the footer on every public page and its links.
The bottom line credits signalco: "© <year> uier · A signalco project", with signalco's mark
(`SignalcoMark`, its official paths in the text colour) inside the link to `brand.parent.url`. Never
redraw the mark; copy it from signalco's source if it changes.

The Resources group links to `/compare`; the comparison pages get the same shared footer and
are included in its public-page coverage.
