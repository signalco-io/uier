# Backups and restore

Maintainer runbook and recorded evidence. Follow the approval and access requirements below;
the written procedure does not establish that a restore has been tested.

Recovery owner: the repository owner, **AleksandarDev**, who names the human restore operator for each
incident. This procedure requires continuous backup; check the live account before using it. It is not
a recovery-time, recovery-point, uptime or regional disaster-recovery commitment. Vercel variables,
email, Azure Blob screenshot bytes and Pulumi state are outside this runbook. New screenshot documents
contain Blob references; restoring Cosmos alone cannot recover missing pixels. Blob versioning and
soft deletion are disabled to avoid retaining redacted/deleted images. See [screenshot storage](screenshot-storage.md). Restores are billed by data restored, including on
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

Observed evidence (source merge, deployment, live configuration and restore are separate checks):

| Gate | Recorded result |
| --- | --- |
| Before, 2026-10-28 17:30 UTC, `az cosmosdb show` | `uierdbaba6cd56`, West Europe; `type: Periodic`, `backupIntervalInMinutes: 240`, `backupRetentionIntervalInHours: 8`, `backupStorageRedundancy: Geo`, `migrationState: null` |
| Isolated policy preview and owner approval, 2026-10-28 | After #160 was closed on a two-resource preview and #166 fixed endpoint output propagation, [PR #173's preview](https://github.com/signalco-io/uier/pull/173#issuecomment-6476843140) showed one in-place account update and 43 unchanged resources. The owner [approved exact head `9aa5ec4`](https://github.com/signalco-io/uier/pull/173#issuecomment-6477041408); it merged as `32bd1ce` with auto-merge disabled. |
| Policy apply and live readback, 2026-10-28 | The [CI apply](https://github.com/signalco-io/uier/actions/runs/40743919009) completed the Cosmos update in 354 seconds at 18:25 UTC. Independent `az cosmosdb show` confirms `Continuous`, `Continuous7Days`, `migrationState: null` and provisioning `Succeeded` in West Europe. The overall job failed on a separate email Event Grid webhook validation error (403); it was not rerun. |
| Subsequent no-diff account preview and full deployment | [Verification PR #183's preview](https://github.com/signalco-io/uier/pull/183#issuecomment-6477622713) showed no account diff after migration. The separate email repair #179's [full production deployment](https://github.com/signalco-io/uier/actions/runs/40747322158) passed. |
| `comments-preview` restore drill, 2026-10-28 | Passed: comment and screenshot deleted in the toolbar, restored from `18:33:00 UTC` in a temporary West Europe account, copied back atomically with matching hashes and remaining TTL, and verified after browser reload. Restore took 13m43s; the separate operator firewall update took 18m42s. Fixture and temporary group cleanup were independently confirmed. See the drill record below. |

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
broader inherited permissions must be checked separately before any restore. For this authorized
drill, recovery owner **AleksandarDev**'s Azure session was checked in the uier tenant and has
existing **Owner** access at the subscription. That includes the required restore and target-write
actions; no new grant was made. Do not assume the preview identity can restore.

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
on the temporary account; inspect each restored container to confirm TTL is disabled. Use approved
private connectivity, or restrict the temporary account to the operator's verified public IPv4.
For the latter, keep public access disabled until one account update sets **both** that exact
single-IP firewall allowlist and `publicNetworkAccess: Enabled`, with `networkAclBypass: None`.
Read those settings back before the first data read. Never use an empty allowlist, `0.0.0.0` or a
broad range. This temporary operator access is removed with the resource group. Keep recovered
content in restricted storage.

```bash
recovery_operator_ip='<verified-operator-public-IPv4>'
az cosmosdb update --subscription "$recovery_subscription" --resource-group "$recovery_group" \
  --name "$recovery_account" --ip-range-filter "$recovery_operator_ip" \
  --network-acl-bypass None --public-network-access Enabled
```

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

## Restore drill record, 2026-10-28

The recovery owner authorized this synthetic, disposable fixture for the drill. No real author
deletion or erasure request was recovered. Only `comments-preview` was restored and only the
following two documents were copied back; production containers and application account settings
were not changed by the drill.

| Evidence | Observed result |
| --- | --- |
| Preview | [PR #175 preview](https://uier-ar4bx2cnn-signalco.vercel.app/security), deployment `dpl_62RkvuYoHGiMixpMJpNEoc5Bv4ty`, signalco/uier, target `preview`, READY |
| Exact fixture | `comment_5lUA2NgCFIROCXTiWWL9v` and `$screenshot_comment_5lUA2NgCFIROCXTiWWL9v`, partition `project:uier00000001` in `uierdata/comments-preview` |
| Delete | Posted through the toolbar with an automatic screenshot; then deleted through its confirmation. Independent point reads confirmed both missing at `2026-10-28T18:35:45.876Z`. |
| Restore point | `2026-10-28T18:33:00Z`, after both original writes and before deletion; checked against the latest restorable timestamp |
| Temporary target | `uier135drillf4147481` in `uier-135-restore-20261028-f4147481`, West Europe; restore parameters selected only `uierdata/comments-preview`, with TTL disabled |
| Restore duration | Submitted `2026-10-28T18:36:14.539373+00:00`; CLI completed successfully `2026-10-28T18:49:57.394430+00:00`: **822.855 seconds (13m43s)** |
| Temporary access | One exact operator-IP firewall rule, no network bypass; its separate account update took **1121.544 seconds (18m42s)**. Public access remained disabled until that update completed. |
| Keys and roles | Restored account keys differed from the source; zero restored data-plane role assignments; the preview identity received no new access |
| Copy-back | Two-document, single-partition **Create** batch; independent readback at `2026-10-28T19:11:41.980Z` matched both document hashes and the screenshot byte hash |
| Retention | Source default TTL `604800`; copied per-item TTL `602261`. Original expiry **2026-11-04 18:29:53 UTC**; copied expiry **2026-11-04 18:29:22 UTC**, 31 seconds earlier. Neither item gained retention. |
| Browser readback | Reloaded the same preview, opened comment #3 and its screenshot; original text, author controls, original age and image rendered. Evidence captured at `2026-10-28T19:13:41.027632+00:00`. |
| Fixture cleanup | Removed again through the toolbar; both exact documents independently absent at `2026-10-28T19:15:58.303Z` |
| Account cleanup | The temporary resource group was deleted; `az group exists` returned `false` at `2026-10-28T19:32:01.371326+00:00`. Its one-IP rule and account keys disappeared with it. |

Steps clarified by the drill: Azure CLI returned the latest restore timestamp in a locale-formatted
UTC string, so it was normalized to ISO 8601 before submission. The operator used the runbook's
single-IP firewall route instead of a private endpoint; access setup was measured separately from
the restore itself. Wait for account provisioning to complete even after the activity log reports
the container restore succeeded. No credential or data from other threads was retained; only
this disposable fixture's metadata, hashes and browser proof are kept as audit evidence. These
timings describe one drill and are not service commitments.

Azure references: [one-way migration](https://learn.microsoft.com/en-us/azure/cosmos-db/migrate-continuous-backup),
[restore permissions](https://learn.microsoft.com/en-us/azure/cosmos-db/continuous-backup-restore-permissions),
[same-account restore](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-restore-in-account-continuous-backup),
[temporary-account restore and timestamps](https://learn.microsoft.com/en-us/azure/cosmos-db/restore-account-continuous-backup).
