# Workspace access and membership

Teams use `src/lib/app/access.ts` / `accessRules.ts` for additive, current workspace/project
authorization. Load one workspace team snapshot for list operations; never revive the old
direct-only predicate or copy inherited grants into a member's direct list. All access writes
go through `mutateAccess` and `AppStore.transact` (workspace revision guard + mutation + 180-day
event). Recheck admin/target/team ownership on retries. Member removal and invitation acceptance
use the same guard; acceptance consumes the workspace invitation atomically, not just its lookup
token. Team archive clears projects and invalidates earlier team invitations; restore starts
empty. Keep public-workspace safeguards and guest/private-thread distinctions. New app routes
are `/app/workspace/teams`, `/app/workspace/teams/[teamId]`, `/app/workspace/users/[userId]`. Admin previews must reject stale
revisions. See [teams and access](../../../docs/teams-and-access.md) for limits, history, erasure,
Session-consistency limits, real preview Cosmos checks and rollback.

- Apart from uier's own public feedback project, which every account joins (`joinPublicProject`), a
  membership is only ever created by an invitation or together with a new workspace (`ensureOwnWorkspace`
  or `createWorkspace` from the workspace menu, one `createAll` transaction each; at most
  `MAX_CREATED_WORKSPACES` per creator). Never recreate a missing member document of a customer workspace: a missing
  member is someone an admin removed, and recreating it undoes the removal (their review tokens, MCP access
  tokens and connected apps work again). `e2e/workspaces.api.spec.ts` and the users e2e tests cover it.
  Member removal uses `mutateAccess` / `AppStore.transact` to conditionally update the workspace
  access revision, delete the versioned member, invalidate old invitations and append its event.
  Read the workspace before counting admins and repeat both on a conflict; never undo a removal
  by recreating its member document. `replaceAndDelete` remains available for older callers.
