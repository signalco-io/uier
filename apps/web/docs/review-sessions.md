# Review sessions

A project reviewer can start a review, collect comments across pages and explicitly send the batch.
Members recover the open draft on another device. Guest drafts follow the browser's visitor identity.
An authorized workspace admin can send or discard a review. Only its author can resume it.

## Storage and publication

- `review/reviewSessions.ts` writes the session and the per-author pointer to the comments
  partition. Starting twice returns the same draft. Each resume creates a fresh draft ID.
- Creating a held thread commits its submission receipt, evidence references and session update
  together. Later mutations use the session etag so a concurrent Send orders them on one side of
  publication. Each thread retains its original read cursor and activity sequence.
- Send creates one immutable membership record for the revision in the same partition transaction.
  The release record also carries the email and integration discovery flags. The release is the
  source of truth for published visibility, including when the worker has yet to index its children.
- The stage before Send keeps replies, mentions, assignments and other activity in uier. The
  common event writer marks this activity as held. Email uses the release for grouped delivery.
  MCP derives its creation events from the same revision. Connected services discover eligible
  children through the scheduled worker. Their shared group preserves the destination on a resume.
- Discard claims the draft before removing its pending threads and attachments. The worker can
  complete an interrupted discard. Previously published revisions stay available.
- A project can hold up to 100 comments in one review across all revisions. Its usual comment rate
  limits still apply.

## Entry points and verification

Review route handlers are in `review/reviewSessionRoutes.ts`. Toolbar reads share the existing
project/BotID boundary and extension contract. The signed-in project inbox uses the same service.
Existing project and thread privacy determine visibility, including link previews, counts and
recipient-specific digests.

`e2e/reviewSessions.api.spec.ts` covers concurrent start and comment writes, delayed Send, held
events, replay, resume with stale draft IDs, guest and admin permissions, interrupted discard
and publication of 100 threads. The [design](../../../docs/design/review-sessions.md) records the
product decisions and the hosted delivery scenarios.
