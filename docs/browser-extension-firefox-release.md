# Firefox releases

The shared [release workflow](../.github/workflows/extension-release.yml) builds Chrome and Firefox
from the same protected `extension-vX.Y.Z` tag on main. Both package versions must match.
Manual dispatch selects `all`, `chrome` or `firefox`; `dry_run` defaults to true.
Dry runs use no store credentials and perform no store writes. Firefox has its own repository flag
and protected environment approval, separate from Chrome.

After adding credentials, run **Extension Firefox account check** from `main` and approve its
protected environment. This reads Mozilla's private upload list without making store writes.
It needs no release tag or publishing flag and never prints credentials or private response bodies.
Verify this bootstrap before enabling store writes.
Mozilla limits `exp - iat` to five minutes. The client uses a 90-second lifetime, including its
30-second clock allowance; a locally valid signature alone does not prove API acceptance.

PR CI runs Mozilla's pinned linter, tests the store client, and checks the unchanged Chrome ZIP.
Review the linter's warnings for static helper templates and bundled libraries; errors fail the job.
These checks do not replace native Firefox hosted acceptance.

Release artifacts include deterministic ZIPs, checksums and source receipts. The Firefox job also
retains [rebuildable source](browser-extension-source.md) from the exact Git commit.

## Submission receipt — 10 November 2026

Version **0.1.5** was submitted successfully and Developer Hub shows **Awaiting Review**. Mozilla
version ID: `6687544`. The [protected publication run](https://github.com/signalco-io/uier/actions/runs/42741438848)
passed and retained the unchanged production ZIP, reviewer source archive and durable store receipt.
The uier icon, native Firefox screenshot, privacy policy and AGPL license are supplied. This is a
submission receipt, not publication approval; the listing is not publicly installable yet.

[Native hosted acceptance](https://github.com/signalco-io/uier/pull/566) used Firefox 159.0.1 on macOS
with all cross-site cookies blocked, the production API and an isolated project on the fictional
`https://uier.io/extension-demo.html` page. Project selection, comments with viewport screenshots,
reload and screenshot retrieval, replies, resolve/reopen, proof renewal after background-script
termination and cross-origin navigation cleanup passed. All 16 packaged resources matched a clean
rebuild of the attached source. The ZIP SHA-256 is
`d06e5013f82c9e21747ec58d2467aad5f37306505685a76926dad30a6f9bdd0c`.

Publishing is enabled with owner review in `extension-firefox-production`; its existing Mozilla
secrets are configured. The [publisher recovery fix](https://github.com/signalco-io/uier/pull/575)
resumed the confirmed original upload without uploading a second package. Native acceptance,
reconciliation evidence, store receipt and listing screenshots are retained on the draft
`extension-v0.1.5` GitHub release.

The website and app installation guide show Firefox as awaiting review. Once Mozilla approves the
[listing](https://addons.mozilla.org/en-US/firefox/addon/uier/), verify native signed-store installation
and record the remaining update/rollout gates before enabling its download link. Temporary add-on
acceptance does not establish store installation or automatic updates.

## Firefox setup

Use environment `extension-firefox-production`, with owner review, the `main` branch and protected
`extension-v*` tags. Configure these values:

| Kind | Name | Value |
| --- | --- | --- |
| Environment secret | `AMO_API_KEY` | Mozilla JWT issuer |
| Environment secret | `AMO_API_SECRET` | Mozilla JWT signing secret |
| Environment variable | `FIREFOX_HOSTED_ACCEPTANCE_URL` | Native Firefox evidence issue comment or Actions run |
| Repository variable | `FIREFOX_PUBLISHING_ENABLED` | `true` after account setup and native hosted acceptance |

Create the publisher profile and API credentials in [Mozilla Developer Hub](https://addons.mozilla.org/developers/addon/api/key/).
Complete email verification, two-factor authentication and developer agreements. The stable add-on
ID is `uier@signalco.io`. Register its exact callback as described in
[browser targets](browser-extension.md#browser-targets).

The publisher sends the unchanged ZIP to AMO v5 with `channel=listed`, polls validation, creates
the first listing or next version, links the published privacy policy through AMO's policy endpoint,
and attaches the exact committed source archive. Categories are scoped to Firefox and compatibility
is desktop Firefox only. The create response's `version` identifies the submitted version even
before a public `current_version` exists.
`apps/extension-firefox/amo-metadata.json` owns listing and reviewer instructions. The AGPL license
text comes from the root `LICENSE`. Check listing/privacy information, screenshots and publisher
contact/trader requirements in Developer Hub before initial public submission. A
`submitted-for-review` receipt is not approval: Mozilla signs/publishes after review. Recheck native
installation and automatic updates after publication.

## Recovery and rollout

The Firefox publishing job follows the Chrome publisher so their artifacts and receipts can share
the existing draft GitHub release without racing its creation. Immutable artifact assets are never
overwritten. Before every non-idempotent store write, a receipt is saved to the draft release.
A lost response leaves a `*-started` phase, which blocks another write. Never delete that receipt
or blindly repeat the write. Reconcile the upload/version in Developer Hub, then correct the
durable receipt with evidence. Polling timeouts after a confirmed upload safely resume polling
the retained upload ID. Package/source hashes and source commit must match on every rerun.
Mozilla upload IDs can use compact 32-character hexadecimal or hyphenated UUID form. Retain the
returned value unchanged. If an older client stopped after receiving a compact ID, preserve the
original receipt and the successful upload response evidence, then resume validation of that
confirmed ID instead of uploading the package again.
Retained binary downloads allow up to 64 MiB so source archives larger than Node's default 1 MiB
child-process buffer can be compared on a rerun. Manual Firefox releases execute the reviewed
publisher at the workflow's main commit. The ZIP, source archive, listing metadata and license
remain pinned to the protected release tag, and the publisher rechecks that commit and ancestry.
This lets an operational publisher fix resume an existing release without changing its package.

Keep `FIREFOX_PUBLISHING_ENABLED` false until native Firefox hosted acceptance is recorded. Keep
its public installation link disabled until the actual listing and installed/update acceptance
are verified. Chrome/Edge receipts do not satisfy these gates.

Primary references: [Mozilla submission API](https://mozilla.github.io/addons-server/topics/api/addons)
and [web-ext reference](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/).
