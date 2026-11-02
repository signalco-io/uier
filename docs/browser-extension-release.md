# Extension releases

The implementation is ready for owner bootstrap; production distribution remains disabled.
Read [the runtime design and hosted gate](browser-extension.md) first. This runbook covers the
Chrome Web Store; native Edge Add-ons is a separate follow-up.

## One-time owner setup

1. Choose the signalco publisher and recovery owners, complete registration/payment, two-step
   verification and the contact/trader details required by the dashboard. Upload the production
   ZIP manually to create the item. Record the actual publisher ID and stable extension ID.
2. Register that ID in the hosted `UIER_EXTENSION_CLIENT_IDS` allowlist; the server derives the exact
   `https://<id>.chromiumapp.org/uier` callback. Keep the development ID separate. Use an isolated
   reviewer account/project with no customer data. Complete [the listing worksheet](browser-extension-listing.md).
3. Record real hosted Chrome **and** Edge acceptance in #268 or an Actions run, including BotID
   issuance/renewal and screenshot retrieval with third-party cookies blocked. A local green test
   cannot satisfy this gate. Keep the store item private/unlisted for the initial tester window.
4. Create a dedicated Google service account and link it to this publisher with the required store
   access. Enable the Chrome Web Store API, IAM and Service Account Credentials APIs needed for
   federation. Follow [Chrome's service-account guide](https://developer.chrome.com/docs/webstore/service-accounts)
   and [Google's OIDC action setup](https://github.com/google-github-actions/auth#workload-identity-federation-through-a-service-account).
   Grant the repository principal `roles/iam.workloadIdentityUser` on that account. Do not create
   a JSON key or personal refresh token. Confirm token generation and an actual v2 status read
   before enabling writes; service-account plus OIDC store access still needs live bootstrap validation.
5. Create the GitHub `extension-production` environment. Allow `main` for manual/status jobs and
   protected `extension-v*` tags for releases; require a reviewer and prevent self-review where
   supported. Protect tag creation/update/deletion using a ruleset limited to release owners.
   Protect main and workflow changes. In the Google provider condition, restrict numeric repository
   and owner IDs, the `extension-production` environment subject, this repository's release/status
   workflow paths, and their allowed refs/event types. Do not trust every workflow in an organization
   or only the environment subject. Release uses `push` on `refs/tags/extension-v*` or manual dispatch
   from `refs/heads/main`; status uses scheduled/manual runs from main. Map the corresponding GitHub
   OIDC claims and test that a PR/other workflow cannot obtain an access token.
6. Set these **environment variables**, using actual identifiers:

   | Variable | Value |
   | --- | --- |
   | `GCP_PROJECT_ID` | Google project ID |
   | `GCP_WORKLOAD_IDENTITY_PROVIDER` | Full `projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>` name |
   | `GCP_SERVICE_ACCOUNT` | Dedicated service account email |
   | `CWS_PUBLISHER_ID` | Actual publisher ID |
   | `CWS_EXTENSION_ID` | Stable 32-letter store item ID |
   | `EXTENSION_HOSTED_ACCEPTANCE_URL` | #268 evidence comment or repository Actions run URL |
   | `CWS_PUBLISHING_ENABLED` | `true` only after hosted and bootstrap acceptance |

   Set repository variable `CWS_STATUS_MONITOR_ENABLED=true` only after setup. The scheduled
   monitor is otherwise disabled. Google tokens are short-lived action outputs, never repository secrets.

## Bootstrap receipt — 2 November 2026

The GitHub, Google Cloud and publisher configuration has been read back:

- `extension-production` (environment ID `26068248854`) permits only the `main` branch and
  `extension-v*` tags. Release jobs require `AleksandarDev`'s review. Self-review remains allowed:
  this is currently the repository's only collaborator, so preventing it would make releases
  impossible. Add a second release owner before requiring independent approval.
- [Tag creation rules](https://github.com/signalco-io/uier/rules/26400994) restrict creation of
  `extension-v*` tags to `AleksandarDev`. The separate [integrity rules](https://github.com/signalco-io/uier/rules/26400995)
  prohibit updates and deletion, with no bypass actors. No extension release tag has been created.
- `CWS_PUBLISHING_ENABLED=false` in the release environment and repository
  `CWS_STATUS_MONITOR_ENABLED=false` keep store writes and scheduled monitoring disabled.
- Google project `uier-extension-publishing` (`672373366839`) has the Chrome Web Store, IAM,
  Service Account Credentials and STS APIs enabled. The dedicated account is
  `uier-extension-publisher@uier-extension-publishing.iam.gserviceaccount.com`; it has no project
  data roles or JSON key. The publisher's service-account table confirms its access.
- Provider `projects/672373366839/locations/global/workloadIdentityPools/github-uier/providers/github`
  trusts GitHub's issuer, numeric repository `1432139886`, owner `89613566`, the protected environment
  subject, and only the release/status workflow paths and allowed refs/events described above.
  The repository principal has `roles/iam.workloadIdentityUser` on that service account.
- The paid publisher is named `signalco`, ID `bf72a9f6-5c5a-454c-87ec-5e159831aa3f`, with a verified
  contact email and two-step verification enabled. Identity/trader verification was submitted and
  is pending. The first production ZIP (0.1.0, source `6faf266d6d0e4ecd373b4837eaf17f92c8795a5c`,
  SHA-256 `f814e18d257c8183675379e774a9de8f068d3729153ffb26599ad168e05ccf70`) created draft item
  `kplfcfnpeljpkbcjgpaefpmggipfpemj`. It has not been submitted for review.
- Google configuration and the publisher/item IDs are set in `extension-production`.
  `EXTENSION_HOSTED_ACCEPTANCE_URL` remains unset. The read-only bootstrap dispatch below is
  implemented; its first live run is still pending.
- The temporary development client `gnhfndanmlbcbcnogfojolkdamnlpjjm` is registered in hosted
  `UIER_EXTENSION_CLIENT_IDS`. [Production deployment 41538315879](https://github.com/signalco-io/uier/actions/runs/41538315879)
  succeeded, and `/extension-verification` returns HTTP 200 with that extension in `frame-ancestors`.
  Remove this test client after the acceptance window. Public availability remains disabled.

An actual OIDC token/store API read, the complete listing and hosted acceptance are still
pending. No store submission or real BotID issuance/renewal is evidenced by this configuration
receipt. The shared environment's
review requirement also applies to manual/status runs; scheduled monitoring must not be described
as unattended until that approval behavior has been addressed.

## Build, dry-run and submit

`apps/extension/package.json` is the version authority. Use three increasing numeric components,
0–65535 each, without leading zeroes; all-zero is invalid. The generated manifest and ZIP agree.
Deploy additive backend support before submitting a dependent extension. Contract v1 remains supported
for at least one year after the last supported v1 release; keep its route/auth regression tests.

After the version change is merged to main, create the corresponding protected `extension-vX.Y.Z`
tag on that commit. A tag push submits when the environment gate is enabled. For a workflow dry-run before
submission, keep publishing disabled, push the protected tag, then dispatch **Extension release**
from main with that existing remote tag and `dry_run=true`. Local build/package tests can be run
before creating any tag. A disabled push run may fail its
publish gate while retaining the validated build artifact; it cannot request Google credentials.
Do not create a release tag merely to test an implementation PR.

The workflow resolves the tag using main's validator, checks main ancestry and version, then builds
and tests that exact commit with Node 24, pinned pnpm and frozen dependencies. Every action is pinned
by SHA. It validates packaged resources, creates a deterministic ZIP, SHA-256/source inventory,
executes broker/release tests, and tests the **unchanged ZIP** in persistent Chromium. Build artifacts,
listing artwork and browser results are retained for 90 days. A dry-run has no Google authentication
or store writes. Dispatch again with `dry_run=false` to submit the tested tag.

The publisher rechecks the tag/commit before authentication, downloads only this run's artifact,
checks its version/hash/clean source, and uses OIDC service-account impersonation immediately before
calling the store. It creates a **draft GitHub release as a durable journal**, uploads immutable ZIP,
checksum and source metadata, and checkpoints a `.store.json` receipt before each write. Keep that
draft and its receipt: it is operational evidence, not an announcement. Do not edit or replace assets.

Chrome Web Store API v2 calls are fixed to the official host, reject redirects and have deadlines:
[media upload](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/media/upload),
[publish](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish),
[fetchStatus](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/fetchStatus).
Publish uses `DEFAULT_PUBLISH`, `skipReview=false`, `blockOnWarnings=true`. Pending review is reported
as **submitted-for-review**, staged approval as **approved-staged**, and actual publication separately
from tester-only availability. Store review is asynchronous.

An async upload is polled at most 12 times at five-second intervals. The v2 status response exposes
submitted/published versions and `lastAsyncUploadState`, **not the unsubmitted upload version**. If the
upload response omitted `crxVersion`, a later `SUCCEEDED` is insufficient to verify it. The job stops
before publish and retains the receipt for dashboard reconciliation. Validate this live behavior in
bootstrap; do not invent an API field, re-upload blindly or infer the version from success alone.

## Status, retries and recovery

For first-item bootstrap, dispatch **Extension store status** from main with `inspect_store=true`
after setting `CWS_PUBLISHER_ID` and `CWS_EXTENSION_ID`. Approve the environment review. This job
requests a fresh read-only Google token and calls v2 `fetchStatus` once for that exact item. It
needs no tag, release journal or GitHub write permission, and never uploads or submits a package.
Its summary records the item name, upload state and submitted/published revisions, omitting the
token and public key. A policy warning or takedown fails the check. Retain the successful Actions
URL as the live bootstrap receipt; a local mock is not proof of Google/store authorization.

**Extension store status** dispatch accepts a tag; blank selects the newest extension draft among
20 recent releases. The optional six-hour monitor uses the same bounded selection. Each run obtains
a fresh read-only Google scope, performs a status read and updates the existing receipt. It never
uploads, publishes or cancels. Both workflows serialize under one store-item concurrency group and
do not cancel an in-flight release.

A matching pending/staged/published receipt resumes with reads only. Different checksums, moved tags,
newer store versions, another pending version, warnings/takedowns and unknown states fail closed.
Rejected/cancelled states are recorded and fail the run. A lost upload/publish response or failed
checkpoint can be ambiguous; inspect the retained receipt and dashboard before doing anything else.
An `uploading`, `upload-processing` or `uploaded` receipt without a matching visible submission cannot
be automatically retried because v2 does not prove the current draft version. Retain the evidence,
confirm the dashboard's uploaded version/checksum provenance, and complete or cancel that submission
there. Do not delete the journal to force an automatic retry. After reconciliation, use status to
record a visible matching submission; otherwise issue a higher-version forward fix.

To pause releases, set `CWS_PUBLISHING_ENABLED=false` and disable the status monitor if needed. Cancel
pending store review in the publisher dashboard; the workflow intentionally has no cancellation API.
Revoke the service-account publisher access and its federation binding to remove release access.
Disabling GitHub publication cannot withdraw a submission already accepted by the store.

Installed versions cannot be downgraded. Fix a bad release with a higher numeric version containing
the correction (or previously good code), then repeat tests/review. Record a real automatic update,
review outcome and browser upgrade in Chrome and Edge. Only then set hosted `UIER_EXTENSION_STORE_ID`
to the actual ID and `UIER_EXTENSION_AVAILABLE=1`; it must also be registered in the client allowlist.
Verify the displayed official store URL and public listing, then finish #268. No credentials, store
item or hosted environment configuration are created by this implementation PR.
