# Integration operations

Project admins manage connections, sync and bounded backfills in project settings. The worker handles delivery separately. A queued request is not evidence that a provider accepted it.

The production operator command can read a bounded ledger summary, retry an exact stopped ledger, resolve an uncertain GitHub create or Slack post, or explicitly resume a Slack notification. It requires an existing workspace, project, current admin user and currently bound provider connection. It does not grant membership or reconnect providers.

## Prepare an exact request

Use the admin’s existing uier user id and the exact workspace/project/provider. Put request data in a local JSON file. Do not put credentials, feedback, provider response bodies or encrypted grant documents in this file. Keep production dotenv files outside the checkout and never source or print them.

From the repository root:

```sh
node apps/web/scripts/run-integration-admin.mjs --input /absolute/path/status.json --env /absolute/path/production.env
```

The environment must identify production (`UIER_DEPLOYMENT_ENV=production`), the production Cosmos account-key configuration, normal `app`/`comments` containers, the existing comments secret and the trusted `https://uier.io` base URL. Local and preview runtimes are rejected. GitHub adoption additionally needs the registered GitHub App configuration. The command prints only bounded ids, status/code, next-attempt timestamps and operation identity; errors are fixed codes. Status does not decrypt credentials or call providers.

```json
{
  "action": "status",
  "workspaceId": "w_existing_user_id",
  "projectId": "abc123def456",
  "userId": "existing_admin_user_id",
  "provider": "github"
}
```

Optional `ledgerId` restricts status to one exact ledger. Lists stop at 1,000 rows; `capped: true` means there may be more. Use exact ledger ids when investigating a specific failure. The command does not accept a ledger from another project, workspace, provider or connection.

## Retry after repairing the cause

Read the provider’s access, destination and current external object first. Repair authentication, permissions, mapping or rate limits before retrying. The admin must attest to the exact request with `operatorAcknowledged: true`.

```json
{
  "action": "retry",
  "workspaceId": "w_existing_user_id",
  "projectId": "abc123def456",
  "userId": "existing_admin_user_id",
  "provider": "slack",
  "ledgerId": "slack_64_lowercase_hex_characters",
  "operatorAcknowledged": true
}
```

Replace the illustrative ledger id with the full id returned by status. Retry preserves uncertain operation identity. It never clears an unknown Slack post or turns that post into a fresh send: the adapter must reconcile it. An empty or partial provider lookup is an unknown result, not proof that nothing was created. A disabled or disconnected connection must be repaired in settings first.

## Resolve one uncertain GitHub create

Use the exact `attempt.operationId` or `unresolvedOperations[].operationId` from status. Cleanup can retain an uncertain create under its original repository while removing independently reachable copies. That receipt continues to block unreviewed recreation. Read back the original repository and app-authored marker before adopting an issue/comment. The command verifies ownership and destination through the GitHub App; it cannot adopt a human-authored object. Adoption and confirmed absence are explicit alternatives:

```json
{
  "action": "github-resolve-create",
  "workspaceId": "w_existing_user_id",
  "projectId": "abc123def456",
  "userId": "existing_admin_user_id",
  "provider": "github",
  "ledgerId": "github_64_lowercase_hex_characters",
  "operationId": "00000000-0000-4000-8000-000000000000",
  "operatorAcknowledged": true,
  "decision": { "kind": "adopt-issue", "issueNumber": 42 }
}
```

For a comment use `{"kind":"adopt-comment","commentId":"123456"}`. Only after a human has established absence in the original destination, use `{"kind":"confirm-absent"}`. Confirming absence permits a later replacement create and can duplicate an undiscovered copy; a timeout, an inaccessible repository or one empty scan is insufficient evidence. The decision is retained as bounded recovery audit metadata. A changed operation, current lease, removed admin or different binding rejects the request.

After a mutation, run status again and read the actual provider object. A queued ledger, accepted API response and external readback are separate evidence. Privacy cleanup can redact or delete app-owned content while edit histories, notifications, cached copies and human replies remain under the provider’s retention rules. Preserve blocked cleanup references until the original access is repaired or the remaining copies are handled manually.

## Resolve or resume a Slack notification

Slack recovery adds no channel-history permissions. Under your own Slack access, inspect the original channel and app bot, match the message to the exact uier source thread, and record the timestamp. Status exposes `threadId` and at most 100 unresolved operation identities per ledger; it does not expose provider metadata or message content. `unresolvedOperationsCapped: true` requires a narrower investigation before changing more operations.

```json
{
  "action": "slack-resolve-post",
  "workspaceId": "w_existing_user_id",
  "projectId": "abc123def456",
  "userId": "existing_admin_user_id",
  "provider": "slack",
  "ledgerId": "slack_64_lowercase_hex_characters",
  "operationId": "00000000-0000-4000-8000-000000000000",
  "operatorAcknowledged": true,
  "originalDestinationReviewed": true,
  "decision": { "kind": "adopt", "ts": "1234567890.123456", "sourceChannelBotMatch": true }
}
```

The source/channel/bot attestation is a human responsibility. The provider still enforces app ownership for later updates/deletes. To record proven absence instead, use `{"kind":"confirm-absent"}`; this can permit a replacement post and can duplicate a copy that was overlooked. An inaccessible channel, expired search window or missing result does not establish absence.

After cleanup has finished and no uncertain post or retained message remains, a separate `slack-resume-notification` request can authorize a new visible notification. Use the same exact scope and ledger fields with `operatorAcknowledged: true` and `newNotificationConfirmed: true`; omit `operationId` and `decision`. It does not clear unresolved posts. The worker may post only after fresh visibility, binding, admin and destination checks pass. Run status and read back Slack afterward.

## Slack rate-limit review

A valid `Retry-After` remains a durable method/workspace cooldown, including delays longer than one
day. Invalid or unrepresentable limits set a persistent `requiresReview` hold shared by projects
using that app/workspace. Status includes fixed `rateReviewMethods` names when readable. Do not
clear a hold just to make a retry succeed: verify the provider's current limit and access first.

After verification, submit an exact scoped request without a ledger id:

```json
{
  "action": "slack-release-rate",
  "workspaceId": "w_existing_user_id",
  "projectId": "abc123def456",
  "userId": "existing_admin_user_id",
  "provider": "slack",
  "method": "chat.postMessage",
  "operatorAcknowledged": true,
  "providerLimitVerified": true
}
```

The command checks current admin, binding, shared installation ownership and grant generation,
then records a release receipt. It clears only the review flag; valid timed cooldowns and channel
leases remain. Other projects sharing the installation are affected by that method's release.
Repeated release is a no-op. Reconnect and save the verified destination in Settings if its binding
is paused; release does not turn sending on or retry a feedback post. Check status and external
readback after subsequent worker execution.
