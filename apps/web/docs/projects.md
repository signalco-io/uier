# Project identity, addresses, deletion and transfer

- `app/projectPublicIds.ts` assigns stable 21-character public Nano IDs lazily with claimed references
  and optimistic concurrency. Generated review URLs, embeds and guest email links use `publicId`;
  internal project ids retain storage/membership/MCP meaning. Review routes use `findReviewProject`,
  retaining legacy random codes but rejecting the fixed codes of uier's own projects (`isUierProvisionedProject`:
  `uier00000001`, `uier00000002`, `uier00000003`). Do not expose abandoned
  references or overwrite a saved public id. See `docs/api.md#public-project-identifiers`.
- **The monitor dashboard project** (`uier00000003`, `provisionMonitorDashboardProject` in
  `comments/publicProject.ts`) is where uier's staff review the uier monitor's local dashboard
  ([the monitor guide](../../../docs/uier-monitor.md#feedback-on-the-dashboard)). It is provisioned in code
  with the other projects of uier's workspace, because that workspace takes no project from the app. It is an
  ordinary invited project, not a feedback project: `isUierFeedbackProject` stays false for it, so its comments
  don't expire and notifications and MCP events work. Only staff reach it, since every other account's
  membership names the user feedback project alone. Its public id is fixed in code (`claimProjectPublicId`
  claims it create-only), so the dashboard's docs can name it; the addresses are the dashboard's default port.
  `e2e/public-project.api.spec.ts` covers provisioning and access, `e2e/monitor-dashboard.spec.ts` the
  toolbar on the dashboard under its own CSP.
- Project deletion (`app/projectDeletion.ts`, the settings Danger zone, `deleteProjectAction`) is admin-only,
  requires the typed name and refuses the public workspace/project in the service too. Disconnect services
  through their own Disconnect paths while the project exists, then store the identifier-only
  `project-deletion` intent before deleting anything. Every step must stay idempotent: the scheduled worker
  (`sweepProjectDeletions`) repeats pending intents and, for a day, the thread/record passes. Retire code and
  public id claims (`project-ref-retired`, `project-public-ref-retired`), never delete them; resolve only live
  claims. Access changes go through `mutateAccess`; members are updated, never deleted or recreated. Threads use
  `deleteProjectThread` + `forgetScreenshot`. A new project-keyed record type must be added to the deletion, the
  privacy policy and [project deletion](../../../docs/project-deletion.md); `e2e/project-deletion{,.api}.spec.ts` cover it.
- Project transfer (`app/projectTransfer.ts`, the Danger zone's Transfer project, `transferProjectAction`) needs an admin
  of both workspaces (stored memberships), the typed name and never touches the public workspace/project. Only the
  project document lives in the workspace partition: it is copied (client matched by name, no integrations) through the
  target's `mutateAccess`, then public id claims and the code point at the target, then the old copy is deleted with its
  grants through the source's `mutateAccess`. Comments, images, read state and notification records are keyed by the
  project and stay. Workspace-bound settings stay behind: services are disconnected and their records deleted, coding
  tools lose the project, grants do not follow (`projectRecords.ts` shares this with deletion). Both documents carry
  `transfer` while it runs and only the one the code names resolves (`isLiveProject`): any new read that takes the
  workspace from the person must use `getProject`/`listProjects` or check it. Everything that can refuse runs before
  anything is disconnected. A `project-transfer` intent makes it retryable (as the caller); `sweepProjectTransfers`
  in the notifications worker finishes it after the switch or gives it up after 15 minutes before it (a retry restarts
  the 15 minutes; a give-up marks the intent abandoned before undoing anything). With the requester's account gone it
  acts as `SYSTEM_ACTOR` (`accessMutations.ts`), which may only remove access. A new workspace-keyed record
  type that names a project must be handled by the transfer and [project transfer](../../../docs/project-transfer.md);
  `e2e/project-transfer{,.api}.spec.ts` cover it.
- Project links (`DbProject.links`, [project settings](project-settings.md)) live on the project document: deletion removes
  them with it and a transfer copies them. They are member-only: no review API, guest page, export or MCP output includes them.
- Project addresses use `normalizeSiteUrl` in `src/lib/app/projects.ts`: schemeless localhost,
  `.localhost` subdomains and loopback IPs default to HTTP, other hosts to HTTPS. Explicit schemes
  and ports are preserved. Review CORS and redirects still require an exact configured origin.
