# Integration activation record

This record covers operator-owned fixtures. Registration, deployment, authorization and delivery
are separate checks. It does not certify customer installations or provider Marketplace review.
Use the [setup runbook](integration-setup.md) for credentials, permissions and rollout gates.

## Registration and production configuration

Verified on 29 October 2026:

| Provider | Application ownership | Registration and distribution |
| --- | --- | --- |
| GitHub | signalco-io | Public [uier for GitHub](https://github.com/apps/uier-for-github), app id 5532642. Issues read/write and Metadata read. Installed only on the private `signalco-io/uier-integration-acceptance` fixture repository. |
| Linear | Dedicated uier workspace, business Google account | Public uier OAuth app; read/write authorization restricted to the Uier team (UIE). Client credentials and webhooks disabled. |
| Notion | Dedicated uier workspace, business Google account | Public uier connection, installable in any workspace. Read, insert and update content; no comments or user-information capability. Fixture authorization shares only the acceptance database. |
| Slack | Dedicated uier workspace (T0CD752K529), business Google account | uier app A0CD684DPU3. Bot scopes `chat:write`, `channels:read`, `groups:read`; OAuth token rotation enabled. Owner approved and activated public unlisted distribution and production gate `1`. Marketplace submission/review remains separate. |

Azure DevOps was added after this verification. Its registration and configuration are recorded
separately below; the four-provider acceptance evidence does not apply to it.

All callbacks use the exact production URLs in the runbook. Provider credentials were captured
privately and stored in the repository's `UIER_INTEGRATION_ENV` secret. No token, client secret,
private key, review code or authorization receipt belongs in this record.

[CI 40954817825](https://github.com/signalco-io/uier/actions/runs/40954817825) passed the web checks
and reviewed an infrastructure preview containing exactly 14 new production provider variables,
with 71 resources unchanged. [Deploy 40955199281](https://github.com/signalco-io/uier/actions/runs/40955199281)
applied those 14 creations and deployed commit `b6177d4d6a91ab1ea0ce921e6a034423f2c6d1b1`.
The production Settings page exposed all four connection actions. An independent private comparison
confirmed all 14 effective provider values matched the registration outputs; values were not logged.

### Azure DevOps registration (31 October 2026)

The production Microsoft Entra web application is **uier**, client id
`1ec6770f-f0f3-4448-bd40-270297dfbb1b`, owned in the Signalco tenant
`c7837eb3-77ca-413b-8653-c97b08886678`. It accepts accounts in any organizational directory,
with the exact callback `https://uier.io/app/azure-devops/callback`. Its only configured API
permissions are delegated Azure DevOps `vso.work_write` and `vso.profile`; the OAuth request adds
`offline_access`. Public-client fallback and both implicit grants are disabled.

`AZURE_DEVOPS_CLIENT_ID` and `AZURE_DEVOPS_CLIENT_SECRET` were added to `UIER_INTEGRATION_ENV`,
preserving all 16 existing provider and Google sign-in entries. The secret expires at
**30 April 2027, 23:59 UTC** and must be replaced before then. The default `organizations`
authority remains in use; no tenant restriction or encryption-key override was added.

Independent Entra readback confirmed the registration, callback, permissions and credential expiry.
A token-endpoint check accepted the client credentials. That check accessed no Azure DevOps data
and does not prove delegated user consent, refresh behavior or delivery.

[CI 41189662678](https://github.com/signalco-io/uier/actions/runs/41189662678), attempt 2, passed
typecheck, build, API/browser essentials and infrastructure checks. Its reviewed Pulumi preview
contained exactly two new production variables, with all 100 existing resources unchanged.
[Deploy 41189995464](https://github.com/signalco-io/uier/actions/runs/41189995464) applied those two
creations, with 100 resources unchanged. Independent private readback matched all 18 effective
credential entries and retained all 26 pre-existing credential and encryption-key values. Both new
variables are encrypted and production-only; previews received none. Existing encryption keys were
retained.

The same workflow deployed commit `d1cd63770b3961ba9338323d3e9cb654a621a734` as
[uier-o8w9ujeg4-signalco.vercel.app](https://uier-o8w9ujeg4-signalco.vercel.app). Independent Vercel
readback confirmed **READY**, production and the `uier.io` alias at 09:48:18 UTC on 31 October 2026.
An authenticated Settings check and the
[live release gates](azure-devops-integration-plan.md#10-testing-and-release-gates) remain pending;
registration, client authentication and deployment do not establish customer rollout acceptance.

## Controlled acceptance

Two invited-only uier projects in the dedicated business account use separate local fixture origins.
Project emails are muted. Both projects authorize the same Notion database, Linear team and Slack
channel. GitHub's installation is restricted to the private fixture repository.

The second Notion authorization did not prevent the first project from loading its real database
fields. Both mappings saved successfully. Linear and Slack reused their existing workspace grants
for the second project. These are authorization checks; external writes and refresh behavior need
their own evidence below.

GitHub's existing-installation path initially stopped on the provider's configuration page without
returning to uier. The added Settings action reuses a workspace-known installation through fresh
PKCE user authorization. The callback still verifies the user's installation access, and repository
selection still requires current repository administration rights. Foreign workspace installation
hints and revoked GitHub grants are rejected.

The live Linear API returns `INPUT_ERROR` with `Entity not found: Issue` for a missing issue UUID.
The adapter now recognizes only that exact issue/comment lookup response as absence; unrelated
input errors still stop delivery. Linear's private upload response uses a signed
`storage.googleapis.com` PUT URL and an `uploads.linear.app` asset URL. Google Storage is accepted
only as an upload destination; Linear bearer tokens are never sent there.

The first fixture-only operator run found the worker's downloaded `UIER_COMMENTS_SECRET` empty.
Vercel does not return Sensitive values. The unchanged production key was recovered privately from
encrypted state and supplied through a repository secret for the scheduled job. No protected
infrastructure or signing key was changed. Manual integration-only runs skip emails, retries and
the unrelated screenshot sweep.

## Observed delivery and cleanup

The fixture-only operator runs used production delivery services with explicit project partitions.
They did not invoke global email delivery. Source creation, editing and screenshot replacement also
ran through the real signed-in toolbar. Separate provider browser/API readback confirmed:

| Provider | Creates and updates | Privacy and restoration |
| --- | --- | --- |
| Notion | Distinct pages for A/B, mapped title and `uier id`, uploaded screenshot, edited text and discussion. Refreshing A and B independently advanced each grant to generation 2; A still read its schema after B's refresh. | A's title became `Removed from uier`, its `uier id` was empty and its body was cleared before Trash. The provider UI confirmed the result; API reads of the trashed object returned `object_not_found`. Making the source shared again restored the same page and current content. B's page stayed unchanged. |
| GitHub | Bot-owned issue #1 in the private fixture repository, updated in place with edited text, a reply and closed status. The deployed existing-installation flow authorized B and listed only the selected private repository. | A's issue was closed and scrubbed, with its managed reply removed. Sharing it again reopened and repopulated the same issue. B's connection remained active. |
| Linear | A's issue UIE-6 included the uploaded private screenshot; B's UIE-5 kept only the protected uier screenshot link with uploads off. Updates preserved the issue and mirrored the reply and Done state. Forced refresh advanced the shared grant to generation 2; both projects still read Linear. | A's old issue became `Removed from uier`, its description was scrubbed, its managed reply disappeared and the issue was trashed. Sharing again created UIE-7 while the old copy remained scrubbed. B retained UIE-5. |
| Slack | Separate roots for A/B. A's edited excerpt and Done status updated its existing root; one bounded thread summary said `Status: Done. 1 new reply in uier.` | Making A private deleted its root and summary. The channel still showed B unchanged. Sharing A again stayed silent until an explicit authorized per-thread resume created a new root. |

The Linear screenshot returned HTTP 401 without authorization and HTTP 206 for an authenticated
range read. Its signed Google Storage upload did not receive a Linear bearer token. These checks do
not promise deletion of provider history, retained files, exports or delivered notifications.

## Release and worker receipts

[PR #220](https://github.com/signalco-io/uier/pull/220) merged as
`48708cfb597253b065a1509343fffc60aa52a2c5`. Local typecheck/build and the required test suite passed
(428 passed, one skipped), as did four focused GitHub desktop browser tests and the PR's CI OK.
[Deploy 40963595990](https://github.com/signalco-io/uier/actions/runs/40963595990) reported **85 resources
unchanged** and deployed [the production build](https://uier-jqf2testo-signalco.vercel.app), aliased to uier.io at
22:11:29 UTC on 29 October 2026. The production Settings page then completed B's GitHub authorization
through the new reuse action.

[Production worker 40964199846](https://github.com/signalco-io/uier/actions/runs/40964199846), running
the merged commit with `integrations_only=true`, succeeded. Its log explicitly skipped email and
reported zero blocked/deferred ledgers for every provider. It delivered B's bounded GitHub backfill
and current edited/Done version to all four providers. Independent store readback found A at source
version 7 and B at version 3, with all eight provider ledgers accepted and inactive. GitHub readback
confirmed separate bot-owned issues #1/#2; B's other provider identities were retained.

[Replay 40964597391](https://github.com/signalco-io/uier/actions/runs/40964597391) also succeeded,
with zero discovered changes and zero checked/blocked/deferred ledgers for every provider. Independent
readback retained exactly two current Notion pages, the two GitHub fixture issues, Linear UIE-5/UIE-7
and the two current Slack roots. The scrubbed Linear UIE-6 remains in provider Trash as expected.
All four production Settings sections remained enabled for both projects.

## Remaining checks

- Complete Azure DevOps's authenticated Settings and dedicated-organization acceptance checks in
  [its release gates](azure-devops-integration-plan.md#10-testing-and-release-gates), including
  regular-user and tenant-admin consent, delegated token scopes and rotation, Contributor writes
  and deletion, inherited processes, uncertain-create reconciliation and Bug/Task rendering.
- Verify Slack's first expiry-driven token refresh; token rotation is enabled, but its current token
  had not expired during this session. Notion and Linear refreshes were exercised live.
- Extend live coverage to disconnect ownership, provider/admin access removal, changed destinations,
  private/archived Slack channels and the deliberately uncertain-write recovery matrix.
- Exercise permanent source deletion separately. This session verified the shared-to-private cleanup
  and restoration path without permanently deleting source feedback or emptying provider Trash.
- Automatic cron timing and normal email delivery remain separate from the successful manual run
  of the production workflow. No email retry was requested and no global email delivery was invoked.
- Exercise the full access, backfill, guest-link and rate-limit matrix in the setup runbook before
  claiming customer rollout acceptance.
- Slack public unlisted distribution is enabled. Marketplace review has not been submitted.
