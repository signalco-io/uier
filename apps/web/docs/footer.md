# Footer

Every public page gets `SiteFooter` from the marketing layout; pages do not render their own.
Contact and social destinations come from `brand.contact` / `brand.social` in `@uier/brand`
(signalco's addresses and X account: uier has none of its own), routes from `src/knownPages.ts`.
Labels are sentence case. `e2e/footer.spec.ts` checks the footer on every public page and its links.
