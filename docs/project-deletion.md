# Project deletion

A workspace admin deletes a project in **Settings → Danger zone → Delete project**. The dialog asks
for the project's name; the server checks the name and the admin role again. After the deletion the
app opens the projects list. uier's public feedback project (`uier00000001`) and anything in the
public workspace cannot be deleted.

The service is [`apps/web/src/lib/app/projectDeletion.ts`](../apps/web/src/lib/app/projectDeletion.ts);
the action is `deleteProjectAction` in
[`src/components/app/projects/actions.ts`](../apps/web/src/components/app/projects/actions.ts).

## Order

1. **Connected services.** Each connected service is disconnected with its own Disconnect path, as the
   deleting admin, while the project still exists. That releases shared provider credentials (a Linear
   or Slack grant no other project uses) and stops delivery. Copies already sent to Notion, GitHub,
   Linear or Slack stay with the provider: deleting a project does not clean them up.
2. **Intent.** A `project-deletion` record (`pk: project-deletion`, id = the project id) stores only
   the workspace id, the public id, the requesting admin and the time. It has no expiry while pending.
3. **Unpublish.** The project document is deleted. Its `project-ref` code claim and every
   `project-public-ref` claim, published or abandoned, are replaced by retired claims with no workspace
   or project id (`project-ref-retired`, `project-public-ref-retired`). They never expire, so neither
   id can be issued again and no review link or embed of the deleted project can reach a new one.
   `findProject` and `projectByPublicId` only resolve live claims.
4. **Access.** In batches of up to 90 records per `mutateAccess` transaction: the project id is removed
   from team `projectIds`, member `projects` lists and invitation `projects`, and an invitation's
   `projectId` is cleared. An invitation that would grant nothing is deleted with its lookup token;
   others keep their remaining expiry. Members are only updated, never deleted or recreated. Each batch
   appends a `project.deleted` access event (180 days) that names the project id.
5. **Coding tools.** Access tokens (`mcp-credential`) and connected apps (`mcp-grant`) that select the
   project lose it. One left with no project, or a connected app left with no workspace, is revoked as
   Revoke in Account does. Selections of `all` are unchanged.
6. **Threads.** Every thread in `project:<id>` goes through the single-thread delete
   (`deleteProjectThread`, then `forgetScreenshot`): a `thread-cleanup` intent, the conditional delete
   with its integration tombstone, the screenshot document and blob, and the thread's subscriptions,
   deliveries and read cursors. Eight threads are deleted at a time; passes repeat until the
   partition lists no comments. The comment number sequence is deleted last.
7. **Records.** The `notifications:<id>` partition (preferences, subscriptions, deliveries),
   `review-read` cursors, `review-code`s, `comment-author` filters, `slack-test` receipts, every
   `<provider>-sync` ledger, `<provider>-connection`, `<provider>-oauth-state`, `notion-grant`,
   `linear-selection` and `github-setup` record of the project.
8. The intent is marked complete and expires one day later.

Integration discovery drops a tombstone whose project code is retired: the project's services were
disconnected and its ledgers removed, so there is nothing to fan out to.

The project's client (`DbClient`) is a workspace record and stays, as it does when a project's client is
cleared; the app shows a client only through projects that point to it. Rate-limit counters (an hour or a
day) and submission receipts (30 days, hashes only) in the comment partition expire on their own. Access events keep the project id for 180 days. Backups keep deleted
data for up to seven days ([backups and restore](backups-and-restore.md)).

## Retries

Every step is idempotent. If a step fails before the project document is deleted, the admin sees the
error and can delete again; the same intent continues. Once the project document is gone, the request
reports success and the scheduled `Review notifications` worker
([`scripts/notifications-worker.ts`](../apps/web/scripts/notifications-worker.ts),
`sweepProjectDeletions`) repeats the deletion every run until it completes. For a day after
completion, the worker also repeats the thread and record passes, which removes a comment that a
request in flight saved after the deletion.

Locally there is no scheduled worker: a failed deletion stays pending in the memory store.

## Tests

`e2e/project-deletion.api.spec.ts` covers admin-only access by exact name, the public project refusal,
removal of comments, images, public ids, grants, invitations, coding tool selections and integration
records, the retained other project, tombstone discovery and the retry sweep.
`e2e/project-deletion.spec.ts` (full suite, Desktop Chrome) covers the confirm dialog, cancel, the
typed name, the redirect and toast, and that the code and public id stop resolving.
