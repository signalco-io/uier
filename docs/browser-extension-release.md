# Extension releases

Version 0.1.2 is published publicly. Native Chrome and Edge automatically upgraded from 0.1.1
and passed post-update acceptance. The production installation link is live, and the deployed
allowlist contains only the stable store client. Version 0.1.3 is prepared on main: it drops the
popup's development-preview label, redesigns the popup, verification helper and icons, and needs
its own protected tag, submission and review. Repeat the hosted helper check before submitting it.
Read [the runtime design and hosted gate](browser-extension.md) first. This runbook covers the
Chrome Web Store. [Firefox and Safari release automation](browser-extension-firefox-safari-release.md)
covers their protected environments, source/native builds, signing, submission and recovery.
Native Edge Add-ons is a separate follow-up.

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

The following records the initial configuration before the first submission. The later submission
receipt below supersedes its draft state and disabled publishing flag.
The GitHub, Google Cloud and publisher configuration was read back:

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
  GitHub reports `use_immutable_subject=true`; the exact accepted environment subject is
  `repo:signalco-io@89613566/uier@1432139886:environment:extension-production`. Do not substitute
  the older name-only subject or disable immutable subjects to make federation work.
- The paid publisher is named `signalco`, ID `bf72a9f6-5c5a-454c-87ec-5e159831aa3f`, with a verified
  contact email and two-step verification enabled. Identity/trader verification was submitted and
  is pending. The first production ZIP (0.1.0, source `6faf266d6d0e4ecd373b4837eaf17f92c8795a5c`,
  SHA-256 `f814e18d257c8183675379e774a9de8f068d3729153ffb26599ad168e05ccf70`) created draft item
  `kplfcfnpeljpkbcjgpaefpmggipfpemj`. It has not been submitted for review.
- Google configuration and the publisher/item IDs are set in `extension-production`.
  `EXTENSION_HOSTED_ACCEPTANCE_URL` now points to the [native Chrome/Edge receipt](https://github.com/signalco-io/uier/issues/268#issuecomment-6591333055).
  [Read-only bootstrap run 41541608506](https://github.com/signalco-io/uier/actions/runs/41541608506)
  succeeded after the immutable subject correction: GitHub OIDC generated a short-lived read-only
  service-account token and v2 `fetchStatus` read the exact draft item. No store write occurred.
- The temporary development client `gnhfndanmlbcbcnogfojolkdamnlpjjm` is registered in hosted
  `UIER_EXTENSION_CLIENT_IDS`. [Production deployment 41538315879](https://github.com/signalco-io/uier/actions/runs/41538315879)
  succeeded, and `/extension-verification` returns HTTP 200 with that extension in `frame-ancestors`.
  Remove this test client after the acceptance window. Public availability remains disabled.

The listing copy, category/language, icon, screenshot, promotional tile, privacy explanations and
owner-approved Limited Use certifications are saved in the draft. Distribution is **unlisted**.
Private reviewer notes explain self-service sign-in and an isolated project;
they contain no shared password or customer account. No store submission or real BotID
issuance/renewal is evidenced by this configuration receipt. The shared environment's
review requirement also applies to manual/status runs; scheduled monitoring must not be described
as unattended until that approval behavior has been addressed.

## First submission receipt — 3 November 2026

[Protected release run 41548857499](https://github.com/signalco-io/uier/actions/runs/41548857499)
succeeded. After the hosted acceptance and read-only bootstrap gates passed, the owner-reviewed
`extension-production` job obtained a short-lived Google token, uploaded the tested package and
submitted it for review. The store dashboard independently shows **Pending review**.

- Protected tag: `extension-v0.1.1`; source: `3d000bb929a301bd69c428091b74d1ed75c7f8d6`.
- ZIP SHA-256: `67e419f7e26d30a8921d53aa83c50c8949bc902be1c9babadb2c0bcee514d116`.
- Item: `kplfcfnpeljpkbcjgpaefpmggipfpemj`; distribution: **unlisted**.
- The draft GitHub release retains the immutable ZIP, checksum, source metadata and
  `uier-extension-0.1.1.store.json` journal with phase `submitted-for-review`.
- [Read-only status run 41551213896](https://github.com/signalco-io/uier/actions/runs/41551213896)
  used a fresh Google token and independently confirmed that phase, updating the same journal.
- Every non-manifest resource matches the native 0.1.1 hosted test build byte for byte. Only the
  test manifest adds the development key; the submitted ZIP is unkeyed.
- The listing accurately describes automatic viewport screenshots and redaction/replacement
  after saving. Reviewer instructions use the isolated self-service project flow and controlled
  `https://uier.io/extension-demo.html` page, without shared credentials or customer data.
- `CWS_PUBLISHING_ENABLED=true` now permits protected, reviewed releases. Repository
  `CWS_STATUS_MONITOR_ENABLED=false` keeps the optional schedule disabled; the shared environment
  still requires review for status jobs. Do not describe it as unattended monitoring.

This receipt records submission, not the later publication. The following status receipt supersedes
its pending-review state.

## First publication receipt — 3 November 2026

[Read-only status run 41614192130](https://github.com/signalco-io/uier/actions/runs/41614192130)
succeeded with a fresh Google token and updated the retained 0.1.1 journal to `published`. The
publisher dashboard independently shows **Published - unlisted**, and the
[official installation page](https://chromewebstore.google.com/detail/uier/kplfcfnpeljpkbcjgpaefpmggipfpemj)
shows version 0.1.1 with installation controls in Chrome and Edge.

## Installed acceptance and first update — 3 November 2026

After owner approval of both installation permission prompts, native Chrome 156 and Edge 156 on
macOS installed the official store item. Both extension-detail pages report version 0.1.1, ID
`kplfcfnpeljpkbcjgpaefpmggipfpemj` and **Chrome Web Store** source. The old unpacked development
copies are disabled. The publisher settings independently show **Verified account**.

Both store-installed packages completed first-party sign-in, exact-origin project selection and
Start review on `https://uier.io/extension-demo.html`. Using only the isolated acceptance project,
they saved comments, restored feedback after reload, retrieved and expanded screenshots, replied,
resolved and reopened. The page's strict CSP denies scripts, connections, frames, images, fonts
and styles. These runs used normal cookie settings; the earlier blocked-third-party-cookie receipt
remains separate evidence. Exit review removed activation in both browsers, preserving the store
installations as the upgrade baseline.

[PR #362](https://github.com/signalco-io/uier/pull/362) passed CI OK and merged the 0.1.2 version
advance. [Protected release run 41616201637](https://github.com/signalco-io/uier/actions/runs/41616201637)
built, tested, uploaded and submitted that update after baseline acceptance:

- Tag: `extension-v0.1.2`; source: `58b84ad458932cdde273f2d03e48c08e959bb8d7`.
- ZIP SHA-256: `c403e2eb79e707035157809e9f6270fe08b718b6e02d54dac68d8ff6d2dbbd13`.
- The clean, unkeyed package retains the four permissions and sole `https://uier.io/*` host grant.
- The draft GitHub release retains its immutable artifacts and `submitted-for-review` journal;
  the publisher dashboard independently shows **Pending review**.
- [Read-only status run 41617355011](https://github.com/signalco-io/uier/actions/runs/41617355011)
  succeeded with a fresh Google token and independently confirmed the matching target version.

This submission receipt records the initial pending state. The following receipt supersedes it.

## Automatic upgrade receipt — 3 November 2026

[Fresh status run 41618951081](https://github.com/signalco-io/uier/actions/runs/41618951081)
confirmed that 0.1.2 passed review and updated its durable journal to `published`.
After owner-approved normal browser restarts with tabs restored, Chrome 156 and Edge 156 first
reported the installed 0.1.1 baseline and then changed to 0.1.2. Both retained the stable ID and
**Chrome Web Store** source. No reinstall, local package or manual update button was used.
This exercised the browser's normal startup update path; see
[Chrome's update lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/extensions-update-lifecycle).

After separate owner approval of the longer renewable sign-in, both upgraded packages completed
first-party sign-in and repeated isolated production review on the strict-CSP HTTPS demo: post,
reload/restoration, screenshot retrieval/expansion (visually checked), reply, resolve and reopen.
The new screenshot disclosure was visible before posting. Exit review removed activation in both
browsers. These native runs use real hosted verification, without local mode or an API proxy.

The public visibility change was submitted separately. Google's first attempt rejected the
homepage and privacy-policy URLs with connection timeouts. Their stored HTTPS URLs are correct;
independent GET/HEAD checks returned HTTP 200 in under a second, including crawler user agents,
and Google Public DNS resolved the production address. Saving the verified declarations and
retrying succeeded: the dashboard confirmed submission and showed **Pending review**.
Automatic publication is enabled for the requested unlisted-to-public transition.

The visibility review then completed; the dashboard now shows **Published - public**.

Production Vercel configuration now registers only the stable store client and sets the actual
`UIER_EXTENSION_STORE_ID`, with `UIER_EXTENSION_AVAILABLE=1`. Deployment
[41623637790](https://github.com/signalco-io/uier/actions/runs/41623637790) stopped during backend login
before any infrastructure apply or web deployment: Azure OIDC succeeded, but the SDK credential
chain stopped at the AWS-hosted runner's metadata endpoint. The workflow now explicitly selects
the verified Azure CLI credential and checks backend login before running the Pulumi action.
[Production deployment 41625585259](https://github.com/signalco-io/uier/actions/runs/41625585259)
then succeeded on source `95d8078ec4674e77a7a44a86fa26c3038681865e`. Its verified Azure CLI
backend login passed and infrastructure reported **108 unchanged** before the web deployment.
The live isolated project's Installation → Use browser extension guide shows **Get the browser
extension**; following it opens the official item at version 0.1.2. `GET /extension-verification`
returns HTTP 200 with `frame-ancestors chrome-extension://kplfcfnpeljpkbcjgpaefpmggipfpemj` and
private/no-store caching. The development client is absent from the deployed policy.

The final production configuration is `UIER_EXTENSION_AVAILABLE=1`, the actual store ID, and
`UIER_EXTENSION_CLIENT_IDS=kplfcfnpeljpkbcjgpaefpmggipfpemj`. The old unpacked copies remain disabled.
[Final read-only store run 41623812550](https://github.com/signalco-io/uier/actions/runs/41623812550)
confirms the 0.1.2 journal is `published`; the dashboard separately confirms public visibility.

Both native browsers also saved replies after the original 15-minute access and five-minute proof
lifetimes without another sign-in. Initial upgraded sign-in completed before 10:53:50 UTC; these
renewal checks ran after 11:11:59 UTC. This is hosted renewal evidence, separate from forced-expiry
package tests. Review activation was stopped afterwards; owner-approved persistent sign-in remains.

The desktop Chrome/Edge, store, release and public installation gates for #268 are complete.
Native Edge Add-ons and other browser/mobile/guest-extension work remain separate follow-ups.

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
and tests that exact commit with Node 26, pinned pnpm and frozen dependencies. Every action is pinned
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
