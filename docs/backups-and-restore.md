# Backups and restore

Maintainer runbook and recorded evidence. Follow the approval and access requirements below;
the written procedure does not establish that a restore has been tested.

Recovery owner: the repository owner, **AleksandarDev**, who names the human restore operator for each
incident. This procedure requires continuous backup; check the live account before using it. It is not
a recovery-time, recovery-point, uptime or regional disaster-recovery commitment. Vercel variables,
email and Pulumi state are outside this runbook. Restores are billed by data restored, including on
the seven-day tier. Keep the source account, production endpoint and Vercel variables unchanged.

## Policy rollout and evidence

The policy change tracked in [#135](https://github.com/signalco-io/uier/issues/135) is deliberately
separate from this runbook. Periodic to continuous is **one-way**. Keep `protect` and all aliases.
Never run `pulumi up` locally or change the policy in the portal or CLI.

1. Record the current policy with this read-only command, before editing infrastructure:

   ```bash
   az cosmosdb show --subscription d22db5bd-ca9a-447c-9b1b-dc56aca401d7 \
     --resource-group uier-production8b2f56d6 --name uierdbaba6cd56 \
     --query '{id:id,location:location,backupPolicy:backupPolicy}' -o json
   ```

2. Open a **policy-only PR with auto-merge disabled**. Its CI `pulumi preview` comment must show
   exactly one in-place account update to `Continuous` / `Continuous7Days`, and no other resource
   changes. If it shows replacement or any other change, close the PR and investigate separately.
   The owner must approve that exact preview and commit before it merges; a new head needs review again.
3. Watch that merge's deployment log. `pulumi up` has a 30-minute job timeout; migration duration
   depends on data size. On failure or timeout, **do not rerun** the job and do not change the policy
   manually. Run the read-only command above, report `backupPolicy.migrationState` and the failed
   deployment to the owner, and hold every merge/push to `main`, including Renovate automerges and
   manual deploy dispatches, until the owner resolves it. Every push would run `pulumi up` again.
4. After a successful deployment, record the output, date and deployment URL. Require
   `backupPolicy.type = Continuous`, `continuousModeProperties.tier = Continuous7Days` and
   `migrationState = null`. A subsequent full CI Pulumi preview must show no account diff.
   Do not treat a successful source merge as proof of migration.

Observed evidence (replace pending entries with actual results; never infer them):

| Gate | Recorded result |
| --- | --- |
| Before, 2026-10-28 17:30 UTC, `az cosmosdb show` | `uierdbaba6cd56`, West Europe; `type: Periodic`, `backupIntervalInMinutes: 240`, `backupRetentionIntervalInHours: 8`, `backupStorageRedundancy: Geo`, `migrationState: null` |
| Isolated policy preview, 2026-10-28 | [PR #160](https://github.com/signalco-io/uier/pull/160) closed without merging: [CI preview](https://github.com/signalco-io/uier/pull/160#issuecomment-6476154512) showed the account plus `vercel-uier-env-cosmos-endpoint-preview` updating (two resources). Auto-merge was never enabled. A new isolated proposal and owner approval are required. |
| Successful deployment, live continuous policy and no-diff account preview | Pending; continuous backup is not yet verified live |
| `comments-preview` restore drill, elapsed time and cleanup | Not run; waiting for policy and restore-access prerequisites |

Only after live confirmation, publish the seven-day point-in-time restore control on `/security`
and deleted-data backup retention on `/legal/privacy-policy`, update its effective date and extend
`e2e/pages.spec.ts` / `e2e/legal.spec.ts`. Keep `/legal/sla` without service commitments. Do not claim
geo-redundancy: continuous backups do not preserve the old periodic policy's geo-replicated snapshots.

## Access and preparation

The named human operator needs **CosmosRestoreOperator** at the subscription or source
**restorable-account** scope (not the production resource group), plus account-write permission on
the destination resource group, for example Cosmos DB Operator there. A subscription owner grants
and records the operator, scope and expiry in the incident record. On 2026-10-28 the read-only
subscription-wide role-assignment listing found **no explicit CosmosRestoreOperator assignment**;
broader inherited permissions must be checked separately before any restore. Do not assume the
preview identity can restore or that a named operator already has access.

Keep **uier GitHub Deployment** at Contributor on `uier-production8b2f56d6`, with its existing
state/key permissions. Add no restore role to CI and no restore workflow. The preview identity
keeps Data Contributor only on `comments-preview` and `app-preview` in the source account.
The human copy operator separately needs data-plane read on the restored container and narrowly
scoped write on the destination. A restored account has **new keys** and does **not** inherit the
preview identity's Cosmos data-plane role assignments. Never put its keys in Vercel, logs or Git.

Before recovery, record the incident's accidental deletion, exact account/database/container,
partition and item ids, UTC time, original container `defaultTtl`, original item `ttl` and `_ts`,
and the author's/erasure decisions. Recover only items removed by mistake. Exclude author-deleted
messages, removed screenshots, abuse, erasure requests and expired data, even if present in backup.
For partial threads, sanitize deleted messages and evidence too. If deletion intent or original
expiry cannot be established, stop and ask the owner; do not copy it back.

## Find the restore point

In the account's **Point In Time Restore** pane, use its event feed for database/container
create, replace and delete times. The feed does not show item edits or deletes: use the incident's
recorded UTC time for those and choose a point after the wanted write and before the mistake.
Use a timestamp within the available backup window and after continuous backup started; a new
migration does not create seven days of history retroactively.

Read-only CLI discovery (use the returned instance id, then the database `ownerResourceId`):

```bash
az cosmosdb restorable-database-account list --account-name uierdbaba6cd56 \
  --subscription d22db5bd-ca9a-447c-9b1b-dc56aca401d7
az cosmosdb sql restorable-database list --instance-id '<account-instance-id>' --location westeurope \
  --subscription d22db5bd-ca9a-447c-9b1b-dc56aca401d7
az cosmosdb sql restorable-container list --instance-id '<account-instance-id>' \
  --database-rid '<database-ownerResourceId>' --location westeurope \
  --subscription d22db5bd-ca9a-447c-9b1b-dc56aca401d7
az cosmosdb sql retrieve-latest-backup-time --resource-group uier-production8b2f56d6 \
  --account-name uierdbaba6cd56 --database-name uierdata --container-name comments-preview \
  --location westeurope --subscription d22db5bd-ca9a-447c-9b1b-dc56aca401d7
```

The latest restorable timestamp bounds a live-container restore; it does not identify the moment
before an item delete. Record the chosen timestamp and confirm both wanted documents existed then.

## Deleted container or database: existing account

This is an incident procedure requiring separate owner approval, **never the drill**. A same-account
restore is only for a genuinely deleted resource; never delete a live container to make it eligible.
Hold `main` merges and deployments so Pulumi cannot recreate an empty resource during recovery.
The owner must arrange a maintenance window that blocks reads and writes to the affected resource
before submission. Keep it inaccessible until author deletions, erasure requests and expirations
have been reconciled. If that cannot be guaranteed, use an isolated temporary account instead.

Restore a missing parent database first. With the approved UTC timestamp, the human operator uses
`az cosmosdb sql database restore --resource-group <source-group> --account-name <source-account>
--name <deleted-database> --restore-timestamp <UTC> --disable-ttl false`. For a deleted child use
`az cosmosdb sql container restore` with the same arguments and `--database-name <database>`.
Specify the subscription explicitly on each command. Do not disable TTL in production. Read back
the restored container's TTL and partition key, reconcile retention and all excluded deletions,
restart SDK clients to discard stale session/continuation tokens, and verify API reads before
lifting maintenance. Review a full Pulumi preview for drift before the owner releases the merge hold;
never remove `protect` or run local `pulumi up` to reconcile it.

## Live container: isolated temporary account and selected copy-back

Restore the smallest affected container into **a new account in its own temporary West Europe
resource group**, with TTL disabled so evidence cannot expire while being examined. Production
continues pointing at `uierdbaba6cd56`. The following is the preview-only drill target; for a real
incident, the owner must review a new exact container/item manifest before any submission.

```bash
recovery_subscription=d22db5bd-ca9a-447c-9b1b-dc56aca401d7
recovery_group='<unique-temporary-restore-group>'
recovery_account='<unique-temporary-account-name>'
recovery_time='<approved-UTC-timestamp-before-delete>'
az group create --subscription "$recovery_subscription" --name "$recovery_group" --location westeurope
az cosmosdb restore --subscription "$recovery_subscription" --resource-group "$recovery_group" \
  --target-database-account-name "$recovery_account" --account-name uierdbaba6cd56 \
  --restore-timestamp "$recovery_time" --location westeurope \
  --databases-to-restore name=uierdata collections=comments-preview \
  --disable-ttl true --public-network-access Disabled
```

Wait for completion and record `provisioningState` and `restoreParameters` from `az cosmosdb show`
on the temporary account; inspect each restored container to confirm TTL is disabled. Provision
owner-approved private connectivity for the human copy operator; do not open the account to the
public network to get around a failed read. Keep all recovered content in restricted storage.

Copy only the approved exact ids using a Cosmos SDK, never a whole-container import. For a thread,
point-read `(comment id, domain)` and `($screenshot_<comment id>, domain)` from the temporary
container and validate their linkage and current deletion/erasure status. Keep original metadata
for expiry calculations; strip Cosmos system fields (`_rid`, `_self`, `_etag`, `_attachments`, `_ts`)
from new resource bodies. Keep ids, partition keys, project and screenshot references unchanged.
Create both documents in one single-partition transactional batch with **Create**, never Upsert,
and verify every result. A conflict aborts the copy for owner review; never overwrite newer data.

For each item calculate its original effective lifetime from its per-item `ttl`, falling back to
the **source** container default (not the TTL-disabled restored container):

```text
originalExpiry = original _ts + original effective ttl
remainingSeconds = floor(originalExpiry - current UTC epoch seconds)
```

Skip an item with `remainingSeconds <= 0`. Set the copied item's `ttl` to its own remaining seconds
immediately before submission, with a margin for write duration; never reset it to seven or 90 days.
Recheck returned destination `_ts + ttl <= originalExpiry` and shorten/delete the copied fixture
if necessary before considering recovery accepted. An original effective TTL of `-1` stays `-1`;
do not turn unknown expiry into unlimited retention. The preview source default observed on
2026-10-28 is `604800` seconds; production `comments` and `app` use `-1` with per-item exceptions.

For an accidentally removed `$sequence_comments`, copy only that sequence in its exact domain
partition. Pause writes to that partition, read the live highest comment number, and use the
greater of that and the backed-up sequence count. Use Create if absent; an existing sequence
needs a fresh read and ETag-conditional repair approved by the owner. Never decrease numbering or
copy rate counters, submission receipts, sessions or sign-in tokens. Read the destination back
independently, check references and original expiry, and verify the affected API/browser flow.

After validation, delete **only the temporary resource group** (verify its exact name and id first):
`az group delete --subscription "$recovery_subscription" --name "$recovery_group" --yes`.
Wait for completion, verify `az group exists` returns `false`, remove restricted local copies and
temporary grants/connectivity, and record cleanup even when an earlier step failed.

## Required drill: comments-preview only

After the policy is confirmed live, obtain the owner's recorded approval for the named human
operator, restore access, temporary resource group/network and billed restore. Use a synthetic
comment and screenshot created solely for this drill, with the test author's prior consent to
delete and restore that fixture. This exception never authorizes recovery of real author deletions.

1. Open a PR preview and confirm its deployment uses `comments-preview`. Post a uniquely named
   synthetic comment with a screenshot in the toolbar. Record preview URL, partition, both ids,
   `_ts`, original TTL/default and the creation time without saving image contents in Git.
2. Wait until the latest restorable time covers both writes. Record a restore point after both
   writes and before deletion, then delete the comment in the toolbar. Confirm both exact documents
   are absent. Never delete the container or touch `comments`, `app` or `app-preview` for this drill.
3. Time the isolated restore above, selecting **only `uierdata/comments-preview`**. Recover only
   the two fixture documents back into **`comments-preview`**, with remaining TTL and an atomic
   create-only batch. Verify the thread and screenshot after reloading the same preview, and record
   independent item readback, effective expiry and unchanged production endpoint configuration.
4. Delete the temporary group and restricted files/grants as above. Remove the restored synthetic
   fixture through the toolbar and confirm absence. Record UTC date, operator, preview/policy PRs,
   approved manifest, restore timestamp, submit/ready times and elapsed duration, any corrected
   steps, readback/browser results and verified cleanup in the evidence table. Leave failed or
   unexecuted steps marked as such; this written procedure is not a successful drill.

Azure references: [one-way migration](https://learn.microsoft.com/en-us/azure/cosmos-db/migrate-continuous-backup),
[restore permissions](https://learn.microsoft.com/en-us/azure/cosmos-db/continuous-backup-restore-permissions),
[same-account restore](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-restore-in-account-continuous-backup),
[temporary-account restore and timestamps](https://learn.microsoft.com/en-us/azure/cosmos-db/restore-account-continuous-backup).
