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

All callbacks use the exact production URLs in the runbook. Provider credentials were captured
privately and stored in the repository's `UIER_INTEGRATION_ENV` secret. No token, client secret,
private key, review code or authorization receipt belongs in this record.

[CI 40954817825](https://github.com/signalco-io/uier/actions/runs/40954817825) passed the web checks
and reviewed an infrastructure preview containing exactly 14 new production provider variables,
with 71 resources unchanged. [Deploy 40955199281](https://github.com/signalco-io/uier/actions/runs/40955199281)
applied those 14 creations and deployed commit `b6177d4d6a91ab1ea0ce921e6a034423f2c6d1b1`.
The production Settings page exposed all four connection actions. An independent private comparison
confirmed all 14 effective provider values matched the registration outputs; values were not logged.

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

Initial independent readback confirmed two distinct Notion pages (including the uploaded screenshot),
the GitHub bot's fixture issue, two distinct Slack messages and Linear issue UIE-5 for project B with
screenshots disabled. Editing project A updated its existing Notion/GitHub/Slack identities while
project B retained its original version. These runs used the production delivery services with
explicit fixture partitions; they did not invoke global email delivery.

## Remaining checks

- Record real creates, updates, screenshots, privacy cleanup and duplicate checks independently
  for each provider and both projects.
- Verify refresh/rotation and disconnect ownership, provider access removal and retired destinations.
- Record the scheduled worker separately from any fixture-only operator run. Existing email worker
  failures do not establish integration success or failure.
- Exercise the full access, backfill, guest-link and rate-limit matrix in the setup runbook before
  claiming customer rollout acceptance.
- Slack public unlisted distribution is enabled. Marketplace review has not been submitted.
