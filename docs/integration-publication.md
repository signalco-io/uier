# Integration publication

Provider registration, public installation, directory submission and review approval are separate
states. The [activation record](integration-activation.md) records deployed configuration and live
delivery. Its remaining acceptance checks still apply; a listing draft does not complete them.

## Provider status

Checked on 29 October 2026:

| Provider | Public installation | Directory or Marketplace review |
| --- | --- | --- |
| GitHub | Public [uier for GitHub](https://github.com/apps/uier-for-github), owned by signalco-io. Start setup from a uier project's Settings. | Draft listing created. Not submitted. Direct Marketplace installation onboarding, listing fields, webhook, security checklist and Marketplace Developer Agreement remain gates. |
| Linear | Public OAuth application in the dedicated uier workspace. | Submission form opened with the business Google account. Not submitted. Review the complete form, company eligibility and assets before submission. |
| Notion | Public uier connection, installable in any workspace. | Listing form opened under the uier business account. Not submitted. Save the listing, complete required fields/assets and submit through the connection profile. |
| Slack | Public unlisted distribution is enabled. | Not submitted. Slack requires at least 10 active installed workspaces throughout review. The dashboard currently reports zero; the controlled installation is not evidence of ten active customer workspaces. |

Do not certify untested behavior or create artificial installations to meet a review threshold.
Keep the dedicated uier workspace/account boundaries used during registration. Private review
contacts use the owner's business account; no credentials or authorization receipts belong in
listing text, images, forms or this record.

## Public materials

The public [integration index](https://uier.io/integrations) links to setup, permissions, limitations,
privacy/disconnect and support details for [Notion](https://uier.io/integrations/notion),
[GitHub](https://uier.io/integrations/github), [Linear](https://uier.io/integrations/linear) and
[Slack](https://uier.io/integrations/slack). Verify these URLs after the materials are deployed before
using them in a submission. Install buttons start at `/app`; OAuth begins only after the admin
chooses a project in its Settings.

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
