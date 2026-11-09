# uier for Safari

Desktop Safari target for the shared [uier extension runtime](../../packages/extension).
The popup, toolbar, API broker and build tools come from local workspace packages. Safari sign-in
uses an extension-owned tab with a first-party callback because Safari does not implement the
WebExtensions identity API. It has not been published to the App Store.

Use Node 26 and the repository's pinned Corepack pnpm. From the repository root:

- `pnpm build` builds the shared dependencies and all browser targets.
- `pnpm -C apps/extension-safari validate` checks the production manifest and resources.
- `pnpm -C apps/extension-safari package` produces a deterministic resource ZIP, checksum and source receipt in `release/`.
- `pnpm -C apps/extension-safari build:test` creates `dist-test/` for the local API. Set `PORT` to choose its port.
- `pnpm -C apps/extension-safari build:hosted-test` creates `dist-hosted-test/` for hosted acceptance.

On macOS, install full Xcode, select its developer directory with `xcode-select`, then run
`pnpm -C apps/extension-safari xcode`. The script uses Apple's `safari-web-extension-packager`,
falling back to its former name, `safari-web-extension-converter`, on older Xcode versions.
It creates a macOS containing app in `xcode/dist/`, using `io.uier.safari` as the app bundle identifier.
The generated extension target uses the `.Extension` suffix. Its logical API client ID is
`io.uier.safari.Extension`; Safari's runtime ID can include signing information and is separate.

Open the generated `.xcodeproj`, select your Apple developer team for the app and extension targets,
then build and run the app. Enable the extension in Safari settings. For local unsigned development,
use Safari's **Allow Unsigned Extensions** developer option as described in
[Apple's running guide](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension).
The command-line tools package alone cannot generate or build this containing app.

`xcode --test` and `xcode --hosted-test` generate separate projects for their corresponding resources.
The generated projects reference their resource directory, so rebuilding updates the app without
copying the JavaScript into a native source tree. Projects are ignored and never overwritten by the
script. Keep owner signing settings in the generated project, and rebuild resources before Xcode.

Register the logical client and the exact `https://uier.io/extension-callback` redirect using
`UIER_EXTENSION_CLIENTS` on the API. Local builds use the matching loopback callback instead.
See [the extension guide](../../docs/browser-extension.md) for registration and security details.

The resource ZIP is input to Apple's packaging flow, not an installable Safari app. Distribution
requires a signed containing app and the appropriate Apple developer registration and review.
CI compiles an unsigned native archive on macOS with full Xcode. The protected release workflow
can sign the app/extension and installer, upload it to App Store Connect and optionally submit
App Review. Configure `extension-safari-production` using [the runbook](../../docs/browser-extension-firefox-safari-release.md#safari-setup).
The default dry run builds resources and an unsigned archive without credentials or store writes.

Record real Safari hosted sign-in, verification renewal, screenshots, navigation and installed-update
acceptance before rollout. Chromium tests do not establish Safari acceptance. This target covers
macOS; iOS packaging and touch acceptance remain separate work.

Apple documents the packaging command and available options in
[Packaging a web extension for Safari](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari).
