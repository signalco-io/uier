# Project mode

A site's toolbar with `data-uier-project` runs in project mode: the project decides who may review and what
they may do. The rules for its notices and gate failures are in [the toolbar guide](../AGENTS.md#rules); the
active account is in [active account and review sign-in](account-switching.md).

## The gate

`project/ProjectGate.tsx` and `project/projectSession.ts`: who the reviewer is and what the project allows
(comments, or a notice with Exit review: sign in, comments off). The review token, the guest name and the visitor
id are kept in the reviewed site's `localStorage`.

## Silent member sign-in

`project/backgroundSession.ts` signs a member in silently through `/review-session`:

- exact frame, origin and nonce checks;
- one three-second attempt per page;
- no popups or storage-access prompts.

The sign-out opt-out and Exit review in this tab take precedence. Only authorized members auto-open the
toolbar without a review link.

## Installation check

`project/installationCheck.ts` is the explicit `uier-check` nonce flow behind the install page
([installation](../../../apps/web/docs/onboarding.md)). It reports the public configuration and status, within a
bounded lifetime, with browser CSP evidence and the read API and verification proof. It never posts a test
comment or sends tokens in a diagnostic report.
