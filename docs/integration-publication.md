# Integration publication

Provider registration, public installation, directory submission and review approval are separate
states. The [activation record](integration-activation.md) records deployed configuration and live
delivery. Its remaining acceptance checks still apply; a listing draft does not complete them.

## Reply permission update, 2 November 2026

Optional reply sync adds Notion read/insert comment capabilities and Slack public/private channel
history bot scopes. The settings remain off until a project admin opts in; Slack requests expanded
scopes only through its explicit reply-access reconnect. Existing public installation and directory
review receipts below describe the earlier permission set. The owner-approved provider-console changes were saved and verified on 2 November; see the
[reply permission receipt](integration-activation.md#reply-sync-extension-2-november-2026). Hosted
reply acceptance remains separate from implementation and local tests.

## Provider status

Summary reconciled on 12 November 2026 against the dated records below; no provider console or
hosted acceptance was repeated during that reconciliation. Registrations/distribution were verified
on 29 October, Notion's submission on 30 October, Azure DevOps registration/deployment on 31 October,
and optional Notion/Slack reply permissions on 2 November. Newer provider decisions must be recorded
before changing an availability or approval claim.

| Provider | Public installation | Directory or Marketplace review |
| --- | --- | --- |
| GitHub | Public [uier for GitHub](https://github.com/apps/uier-for-github), owned by signalco-io. Start setup from a uier project's Settings. | Draft listing created. Not submitted. Direct Marketplace installation onboarding, listing fields, webhook, security checklist and Marketplace Developer Agreement remain gates. |
| Linear | Public OAuth application in the dedicated uier workspace. | Directory submission on hold. The operator confirmed there is no registered company, so the published formal-company criterion is not met. Public OAuth installation remains available. |
| Notion | Public uier connection, installable in any workspace. | Submitted for review on 30 October. Notion displayed the success confirmation. Awaiting provider review; no approval or published listing is claimed. |
| Azure DevOps | Multitenant Entra application registered and production credentials deployed on 31 October. Client authentication passed; hosted user consent, Settings, refresh and work-item delivery remain pending. See the [activation receipt](integration-activation.md#azure-devops-registration-31-october-2026). | Microsoft has no Azure DevOps directory review for OAuth apps. Publisher verification in Entra is optional and not recorded. Registration does not establish delegated delivery acceptance. |
| Slack | Public unlisted distribution is enabled. | Not submitted. Slack requires at least 10 active installed workspaces throughout review. The 29 October dashboard reported zero; the controlled installation is not evidence of ten active customer workspaces. |

Do not certify untested behavior or create artificial installations to meet a review threshold.

The public guides show a dated installation/listing status separately from checked workflow scope,
using `apps/web/src/lib/integrations/publication.ts`. They keep Azure DevOps delegated acceptance,
Slack's first expiry-driven refresh and hosted imported-reply/edit/delete acceptance visible. All
five adapters implement optional reply sync, including Slack; the old notification-only receipts
do not establish that later workflow. Features stay aligned with the shared catalog and adapter
capabilities; these disclosures do not enable or disable a connection.
Keep the dedicated uier workspace/account boundaries used during registration. Private review
contacts use the owner's business account; no credentials or authorization receipts belong in
listing text, images, forms or this record.

## Notion review submission

The saved draft is named **uier**, with tagline **Turn website feedback into Notion pages.**
It uses the **Workflow automation** feature and **Design** category, the existing uier mark,
and the deployed Notion product illustration. Description and setup steps disclose one-way
background delivery, database mapping, private-feedback exclusions and cleanup/history limits.
The installation URL is `https://uier.io/integrations/notion`; the website, privacy and terms links
were independently checked and returned HTTP 200 on 30 October.

Notion initially blocked submission because the Marketplace creator profile was incomplete. The
profile is now saved as **uier**, handle **@uier**, with the uier mark, public website and an
independent-developer description. The listing identifies **Aleksandar Toplek (independent
developer)** rather than claiming a registered company. The optional email contact switch is off;
no location was supplied.

After profile creation, the saved draft was reopened and submitted. Notion displayed **Submitted
for review**, with the message **After review, your public connection will be listed on the
connections gallery.** The underlying form also reported that the connection already has a
listing submission. The visible confirmation, rather than an attempted click, is the submission
receipt. Track the result from the connection listings dashboard; approval and publication remain
separate provider decisions.

## Public materials

The public [integration index](https://uier.io/integrations) shows each provider's logo and optional
features, the rules every integration shares, and a suggestion form that opens the showcase toolbar's
feedback dialog. It links to features, configurable settings, setup, permissions, limitations,
privacy/disconnect and support details for [Notion](https://uier.io/integrations/notion),
[GitHub](https://uier.io/integrations/github), [Linear](https://uier.io/integrations/linear),
[Azure DevOps](https://uier.io/integrations/azure-devops) and [Slack](https://uier.io/integrations/slack).
Verify these URLs after the materials are deployed before using them in a submission. Install buttons
start at `/app`; OAuth begins only after the admin chooses a project in its Settings.

[PR #223](https://github.com/signalco-io/uier/pull/223) merged these materials as
`bc65831c3032bba05e643cb5d31358ea4ea1ce82`. CI passed and
[production deploy 40969478967](https://github.com/signalco-io/uier/actions/runs/40969478967)
succeeded on its second attempt after a provider-download rate limit. Infrastructure reported
95 resources unchanged. All five public guide pages returned HTTP 200, and all seven served PNGs
matched their committed SHA-256 hashes. This is deployment evidence, separate from provider review.

Artwork is rendered from the existing brand vectors, constants and Geist fonts, without customer
data. These are labelled product illustrations, not screenshots of a customer workspace. Run:

```sh
cd apps/web
node scripts/render-integration-listings.mjs
```

The renderer writes `public/integrations/`:

- `icon.png` and `icon-white.png`: transparent 320 × 320 brand marks.
- `<provider>-showcase.png`: 1600 × 1000 product illustrations for each provider.
- `github-feature.png`: 965 × 482 feature-card background. GitHub overlays the app name and logo.

Linear's directory asks for a color icon, a white monochrome icon and one to three 1600 × 1000
showcase images. Notion requires an icon and gallery images. GitHub additionally requires product
screenshots; do not represent the illustration as a screenshot.

## Review requirements

- [GitHub requirements](https://docs.github.com/en/apps/github-marketplace/creating-apps-for-github-marketplace/requirements-for-listing-an-app)
  distinguish free listings from paid-app installation minimums. Use a free plan aligned with uier's
  current pricing promise. Complete the actual listing checklist, accept the applicable agreement
  with owner approval and verify direct installation before requesting publication.
- [GitHub listing artwork](https://docs.github.com/en/apps/github-marketplace/listing-an-app-on-github-marketplace/writing-a-listing-description-for-your-app)
  includes a logo, feature-card background and high-resolution product screenshots.
- [Linear's directory](https://linear.app/docs/integration-directory) uses its linked submission form
  and requires useful public integrations built by formal companies. Do not infer legal entity
  information from the product name.
- [Notion's listing guide](https://developers.notion.com/guides/get-started/marketplace-listing)
  describes saving a draft, submitting for review and tracking the submitted status separately from
  OAuth availability.
- [Slack's current installation requirement](https://docs.slack.dev/changelog/2026/09/01/slack-marketplace-install-requirement/)
  requires 10 active installed workspaces throughout review. The previous reduced threshold is
  superseded. Its [review guide](https://docs.slack.dev/slack-marketplace/slack-marketplace-review-guide/)
  also requires installation, onboarding, use and uninstall testing outside the development workspace.

Record each submission's actual receipt and status here. “Submitted” is not approval, publication
or proof of customer acceptance. Update the Slack guide's unlisted wording only after a Marketplace
listing is actually approved and published.
