# Security and open source pages

`public/.well-known/security.txt` publishes the security@uier.io reporting contact and repository policy
using RFC 9116. `next.config.ts` redirects `/security.txt` to that canonical location. Keep its
contact aligned with `brand.contact.security` and `SECURITY.md`, and renew its fixed `Expires`
date before it passes; requests and builds must not silently extend it. `e2e/seo.api.spec.ts`
checks delivery, format, contact, expiry and the redirect. See
[security disclosure discovery](../../../docs/operations.md#security-disclosure-discovery).

`/security` lists only controls that are in place and can be checked in this repository; remove a
control from it when it stops being true, and add one only when it ships. `/open-source` mirrors the
licenses in each `package.json`, the root `LICENSE` and the README "License" section. Both have the
repository's `SECURITY.md` and `CONTRIBUTING.md` as counterparts; keep them saying the same thing.
`e2e/pages.spec.ts` checks them.

`/security` has a cover beside its header (under it below `lg`): `security/SecurityCover.tsx`, the
mark inside a large shield with fading outlines over a dot grid. It is static inline SVG and CSS
drawn only from the brand tokens (so it follows light and dark), `aria-hidden`, with a fixed height
per breakpoint so it never shifts the page. It belongs to this page only; other pages' covers are
their own.

The security controls distinguish Pulumi deletion protection from Azure management locks and
state that approving reviews are not required. Renovate can automerge only selected development
type/browser-test dependencies after three days. Keep those controls aligned with `renovate.json`,
workflow SHA pins and the current main ruleset. The completed credential rollout's dated activation
and boundary evidence is in [the rollout record](../../../docs/ci-credential-rollout.md).

The public controls distinguish guest cookies/storage/header identity, project review tokens and
background member sign-in. Status permission, message removal and whole-thread deletion are separate;
workspace admins include uier staff in the feedback projects. Public/guest context is coarse; members
can read available reproduction details. uier feedback has a 90-day TTL even when signed in; customer
project feedback stays until deleted. Input sizes come from `comments/limits.ts` (the bulk-read module
re-exports its unchanged limit), so screenshot/drawing bodies cannot drift behind a blanket 16 KB
claim. Markdown is rendered by the shared parser without executing raw HTML. Reporting scope matches
`SECURITY.md`, including review/extension APIs and all three supported bundles.

The continuous-backup control and privacy retention line describe the verified live
`Continuous7Days` policy in West Europe. Keep the seven-day wording aligned with the
[backup evidence](../../../docs/backups-and-restore.md) and `e2e/pages.spec.ts` / `e2e/legal.spec.ts`; add no recovery-time, recovery-point,
regional disaster-recovery or uptime commitment. Restore drills and remaining-TTL copy-back are
documented in that runbook.
