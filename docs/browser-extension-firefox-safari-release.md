# Firefox and Safari releases

The shared [release workflow](../.github/workflows/extension-release.yml) builds every browser
from the same protected `extension-vX.Y.Z` tag on main. All three package versions must match.
Manual dispatch selects `all`, `chrome`, `firefox` or `safari`; `dry_run` defaults to true.
Dry runs use no store credentials and perform no store writes. Browser-specific repository flags
and dedicated environment approvals control the new publishers independently of Chrome.

After adding credentials, run **Extension browser account check** from `main`, select the browser,
and approve its environment. This uses authenticated reads only: Mozilla's private upload list or
the exact Safari app record. It needs no release tag or publishing flag. Verify this bootstrap
before enabling store writes; it never prints credentials or private API response bodies.

PR CI runs Mozilla's pinned linter, tests the store clients, and compiles an unsigned Safari archive
on a macOS runner with full Xcode. The native build compares every embedded extension resource
with the shared build. These checks do not replace native hosted acceptance. Review the linter's
warnings for static helper templates and bundled libraries; errors fail the job.

Release artifacts include deterministic resource ZIPs, checksums and source receipts. The Firefox
job also retains [rebuildable source](browser-extension-source.md) from the exact Git commit. The
macOS release job verifies/extracts its retained resource ZIP before compiling. The protected Safari
signer uses those same resources and never rebuilds JavaScript after downloading the artifact.

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
the first listing or next version, and attaches the exact committed source archive.
`apps/extension-firefox/amo-metadata.json` owns listing and reviewer instructions. The AGPL license
text comes from the root `LICENSE`. Check listing/privacy information, screenshots and publisher
contact/trader requirements in Developer Hub before initial public submission. A
`submitted-for-review` receipt is not approval: Mozilla signs/publishes after review. Recheck native
installation and automatic updates after publication.

## Safari setup

Enroll the publisher in the Apple Developer Program, then create a macOS App Store Connect app
with bundle ID `io.uier.safari` and an extension bundle ID `io.uier.safari.Extension`. Generated
Xcode targets and provisioning profiles must match both IDs. The account belongs to the verified
person or legal organization publishing uier; product names do not replace account-holder identity.

Use environment `extension-safari-production`, with owner review and the same branch/tag limits:

| Kind | Name | Value |
| --- | --- | --- |
| Environment variable | `APPLE_TEAM_ID` | Ten-character developer team ID |
| Environment variable | `ASC_APP_ID` | Numeric App Store Connect app ID |
| Environment variable | `ASC_KEY_ID` | App Store Connect API key ID |
| Environment variable | `ASC_ISSUER_ID` | API issuer UUID |
| Environment variable | `SAFARI_SIGNING_IDENTITY` | Application distribution certificate name or SHA-1 identity |
| Environment secret | `ASC_PRIVATE_KEY` | Downloaded API key PEM (`.p8`) |
| Environment secret | `SAFARI_CERTIFICATES_P12_BASE64` | Base64 PKCS#12 containing application and Mac installer distribution certificates/private keys |
| Environment secret | `SAFARI_CERTIFICATES_P12_PASSWORD` | PKCS#12 import password |
| Environment secret | `SAFARI_APP_PROFILE_BASE64` | Base64 App Store distribution profile for the app |
| Environment secret | `SAFARI_EXTENSION_PROFILE_BASE64` | Base64 App Store distribution profile for the extension |
| Environment variable | `SAFARI_HOSTED_ACCEPTANCE_URL` | Native Safari evidence issue comment or Actions run |
| Environment variable | `SAFARI_SUBMIT_FOR_REVIEW` | `false` for upload/processing only; `true` also submits App Review |
| Environment variable | `SAFARI_METADATA_READY` | `true` when required listing/review metadata is complete |
| Repository variable | `SAFARI_PUBLISHING_ENABLED` | `true` after signing setup and native hosted acceptance |

Use an API key with access to this app and permissions to upload and submit it. Complete the
App Store listing, privacy details, age rating, review contact, screenshots, export-compliance
answers and agreements in App Store Connect. Never invent identity/legal answers in CI. The
account holder completes enrollment, identity verification and any membership payment.

The certificate action imports into a temporary keychain and cleans it after the job. Temporary
API-key/profile files stay outside retained artifacts and are removed in `finally`. Profiles are
also removed from Xcode's lookup directories. Signing fails on expired profiles or mismatched
teams/bundle IDs. Versions must fit `CFBundleVersion`: up to four digits, then two, then two.
Marketing and build versions match. A used version cannot be uploaded again; release a higher one.

The signed app and installer are verified before Transporter uploads the installer. The client
then polls for that exact app/version/build. With review disabled it stops at `uploaded`; this
does not configure TestFlight groups or announce availability. With review enabled it selects or
creates the macOS version, attaches the validated build, creates a review submission and item,
then submits them. New versions request release after approval; existing release settings are
preserved. Missing listing/review metadata fails closed. Neither upload nor submission claims
Apple approval or public availability.

## Recovery and rollout

Browser publishing jobs run sequentially so their artifacts/receipts can share the existing draft
GitHub release without racing its creation. Immutable artifact assets are never overwritten.
Before every non-idempotent store write, a receipt is saved to the draft release. A lost response
leaves a `*-started` phase, which blocks another write. Never delete that receipt or blindly repeat
the write. Reconcile the upload/version/submission in the store dashboard, then correct the
durable receipt with evidence. Polling timeouts after a confirmed upload safely resume polling
the retained upload ID/build. Package/source hashes and source commit must match on every rerun.

Keep repository publishing flags false until the corresponding native hosted acceptance gate
is recorded. Keep public installation links disabled until that browser's actual listing and
installed/update acceptance are verified. Chrome/Edge receipts do not satisfy these gates.

Primary references: [Mozilla submission API](https://mozilla.github.io/addons-server/topics/api/addons),
[Safari packaging](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari),
[Safari distribution](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension),
and [Apple Transporter](https://help.apple.com/itc/transporteruserguide/en.lproj/static.html).
