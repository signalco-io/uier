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

The security controls distinguish Pulumi deletion protection from Azure management locks and
state that approving reviews are not required. Renovate can automerge only selected development
type/browser-test dependencies after three days. Keep those controls aligned with `renovate.json`,
workflow SHA pins and the current main ruleset; do not claim the pending credential rollout is active.

The continuous-backup control and privacy retention line describe the verified live
`Continuous7Days` policy in West Europe. Keep the seven-day wording aligned with the
[backup evidence](../../../docs/backups-and-restore.md) and `e2e/pages.spec.ts` / `e2e/legal.spec.ts`; add no recovery-time, recovery-point,
regional disaster-recovery or uptime commitment. Restore drills and remaining-TTL copy-back are
documented in that runbook.
