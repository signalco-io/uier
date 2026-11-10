# Project transfer

A workspace admin moves a project to another workspace in **Settings → Danger zone → Transfer
project**. The person must be an admin of both workspaces. The dialog offers every other workspace
they administer (the first one is chosen when there is only one), lists what stays behind and asks
for the project's name. The server checks both admin roles from the stored memberships, the name and
the target again. After the transfer the app opens the target workspace at the project, at the same
address. uier's feedback projects (`uier00000001`, `uier00000002`) and the public workspace never move, in
either direction.

The service is [`apps/web/src/lib/app/projectTransfer.ts`](../apps/web/src/lib/app/projectTransfer.ts);
the action is `transferProjectAction` in
[`src/components/app/projects/actions.ts`](../apps/web/src/components/app/projects/actions.ts). The
helpers it shares with deletion (grant removal, disconnecting services, workspace records) are in
[`projectRecords.ts`](../apps/web/src/lib/app/projectRecords.ts).

## What moves

Everything keyed by the project, not by its workspace, stays where it is and so moves with it:

- Comments and replies, their numbers, history, private flags, assignees, priorities, verification
  state and screenshots (the `project:<id>` partition and its image blobs).
- Read state (`review-read`), notification preferences, follows and pending deliveries
  (`notifications:<id>`).
- Page check summaries (`page-checks:<id>`, [page checks](api.md#page-checks)).
- The project's internal id, its public id and every review link and embed that uses either.

The project document is the one thing in the workspace's partition, so it is copied. The copy keeps
the id, public id, name, addresses, environments, who can comment, the review brief, page state, the
email excerpts setting, the board's column sorts, status, creator and creation time.

The project's **client** is matched by name: the target workspace's client with that name, or a new
one there with the old client's description, icon and colour. The old workspace keeps its client;
the app shows it only through projects that point to it.

## What stays behind

Settings that belong to the old workspace are listed in the dialog and do not follow the project:

- **Connected services.** Each one is disconnected through its own Disconnect path, as the
  transferring admin, while the project is still in the old workspace. That releases provider
  credentials no other project uses and stops delivery. Its connection, grant, selection, OAuth state,
  GitHub setup and every sync ledger of the project are then deleted, so connecting again in the new
  workspace starts fresh. Copies already sent to Notion, GitHub, Linear, Azure DevOps or Slack stay
  with the provider; a backfill after reconnecting creates them again as new items.
- **Access.** Everyone in the old workspace loses access, admins and people with all projects too,
  unless they also have it in the new one; the dialog counts them. Team grants, direct member grants
  and pending invitations in the old workspace lose the project, as on deletion (an invitation for this project alone is deleted with its lookup token).
  Members are only updated. In the new workspace the project arrives with no grants of its own: its
  admins and people with access to all projects see it; admins invite or add others there. Any grant
  a previous stay of the project in the new workspace left behind is removed in the same transaction
  that writes the copy, so old access never returns with it.
- **Coding tools.** Access tokens and connected apps of either workspace that select the project lose
  it; one left with nothing selected is revoked, as Revoke in Account does. Selections of `all` are
  unchanged and reach the project only through the workspace it is in. MCP event subscriptions,
  their cursor and delivery rows are deleted.
- **Author filters and Slack test receipts** of the old workspace that name the project are deleted.
- **Access history.** The old workspace's events stay there. Each workspace gets an event that names
  the project but neither workspace (`project.transferred-out`, `project.transferred-in`).

Names on comments follow the new workspace: an author or assignee who is not a member there reads as
"Former member", as for anyone who left a workspace. Their own notification follows stop delivering,
because delivery checks current membership and access each time.

## Which document is the project

While a transfer runs, the project document exists in both workspaces and both copies carry
`transfer: { from, to }`. A marked document is the project only where the project code
(`project-ref`) points (`isLiveProject` in `projectPublicIds.ts`); an unmarked one always is, so
ordinary reads cost nothing extra and a marked one costs one point read. Every read that takes the
workspace from the person checks it: `getProject` (and through it `getVisibleProject`, comment
actions, the screenshot route, MCP credentials and grants, realtime tickets), `listProjects` (the
sidebar, project lists, My work), team project grants, integration admin and the review API's write
recheck. A public id lookup that lands on a marked copy, or on a workspace without the project, follows the code. So the new workspace sees
nothing before the switch and the old one nothing after it, however a run is interrupted.

## Order

1. **Checks.** Admin of both workspaces (stored memberships), the exact name, a project code that names
   the old workspace, and no pending deletion. An old project gets its public id now, as its first
   read would.
2. **Intent.** A `project-transfer` record (`pk: project-transfer`, id = the project id) stores only the
   two workspace ids, the requesting admin and the time. A second transfer of the same project to
   another workspace is refused while one may still be running (15 minutes); after that the earlier
   one is finished or given up first (below).
3. **Mark** the old document with the transfer.
4. **Copy.** Through the new workspace's access guard (`mutateAccess`, the person must still be its
   admin): any grants left from an earlier stay are removed, and the marked copy and its client are
   written in one transaction with a `project.transferred-in` event. Everything that can refuse
   runs here, before anything is disconnected or removed.
5. **Workspace-bound settings** are disconnected and deleted (above), while the project is still in the
   old workspace. Then the copy picks up settings saved meanwhile.
6. **Switch.** Every public id claim, then the project code, names the new workspace (only if this
   transfer's copy is there). From here `findProject`, `findReviewProject` and every review and MCP
   request use the copy, and the old document is no longer the project.
7. **Leave.** Through the old workspace's access guard, the grants are removed and the old document is
   deleted with the last batch, in a `project.transferred-out` event. A copy is only removed while the
   project code names another workspace.
8. The copy's mark is cleared, and the intent is marked complete and expires one day later.

A retry runs as the person retrying: they must be an admin of both workspaces, and the access events
name them.

## Retries and the scheduled sweep

Every step is idempotent. Until the project code names the new workspace, the old document is the
project and a retry from its Danger zone continues the pending transfer. After the switch, the old
copy is no longer the project (Delete project and another transfer answer "This project no longer
exists"), and steps 7 and 8 are finished by:

- the scheduled `Review notifications` worker (`sweepProjectTransfers`, after the project deletion
  sweep), which settles every pending transfer, as its requester or, once the requester's account is
  gone, as uier itself (`SYSTEM_ACTOR`: it may only remove access, never act as an admin; Activity shows
  "uier"); one that fails never stops the others;
- a new transfer of the project, or its deletion, which settles the earlier one first.

A retry restarts the 15 minutes, so the sweep leaves a running retry alone. Settling finishes a
transfer whose code already names the new workspace. One that never switched over and is older than
15 minutes is given up. The intent is marked abandoned first, under its version, so a retry that
starts afterwards settles it before starting over, and a run still going stops before it points
review links at the new workspace ("The transfer was stopped before it finished"). Then its public
ids point back to the old workspace, the copy in the new one is removed (`project.transfer-abandoned`,
"ended an unfinished transfer of ..."), the old document's mark is cleared and the intent is marked
complete. Workspace-bound settings
it already disconnected stay disconnected. One that may still be running is left alone, and project
deletion refuses the project until it ends.

Locally there is no scheduled worker; a new transfer or deletion settles an interrupted one.

## Tests

`e2e/project-transfer.api.spec.ts` covers admin-only access in both workspaces from the stored
memberships, the exact name, other workspaces' projects, the public project and workspace, action
input validation, a full move (comments, replies, image, numbers, read state, notification settings,
ids, links, settings, client by name and its details), who sees it before and after, the grants,
services, coding tools and webhooks left behind, the preview's counts, activity sentences, moving
back without old access, an interrupted transfer before the switch (the new workspace's admin and
members see nothing, cannot grant it or mint tokens for it) and after it (the old workspace's
commenter and admin see nothing and cannot mint tokens), refusal of deletion and a second transfer
meanwhile, the sweep finishing one and giving another up, a new transfer replacing an interrupted
one, a retry the sweep leaves alone, a run a give-up overtakes stopping before the links move, and the
sweep settling transfers whose requester's account is gone. `e2e/notificationWorker.api.spec.ts` checks the worker runs the sweep.
`e2e/project-transfer.spec.ts` (full suite, Desktop and Mobile Chrome) covers the Danger zone row
without another workspace, the dialog, the typed name, the redirect into the new workspace, the
unchanged public id and the old workspace without the project.
