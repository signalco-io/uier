# Connected service setup and activation

The code and local stubs do not register provider applications or prove that a real installation
works. Provider registration, credentials, distribution approval and customer-data acceptance are
operator gates. The [activation record](integration-activation.md) separates completed registrations
and production configuration from live delivery checks and remaining rollout work.

A current uier workspace admin chooses a destination in each project's Settings. Providers are
independent: configuring one does not enable another. Private feedback and the public showcase are
excluded. Delivery runs in the scheduled review-notifications worker; a queued backfill or a successful
settings action does not prove an external write. See [shared delivery](integrations.md) and the
[Notion](notion-integration-plan.md), [GitHub](github-integration-plan.md),
[Linear](linear-integration-plan.md) and [Slack](slack-integration-plan.md) plans.

## Production credentials

An owner supplies one optional GitHub repository secret, `UIER_INTEGRATION_ENV`, as a JSON object
whose values are strings. CI passes it only to Pulumi. `infra/src/integrations.ts` rejects unknown
names, empty or non-string values, localhost endpoint overrides and malformed encryption rotations.
Values are wrapped as Pulumi secrets and created as retrievable, encrypted, production-only Vercel
variables (`sensitive: false` in the provider). The scheduled worker uses the existing production
environment-pull flow, so write-only Sensitive variables would leave it without credentials and
encryption keys. Authorized Vercel members and that workflow can retrieve these values; they are
never public/client variables. The map itself is not a Vercel variable. No provider credentials are
added to previews or development deployments. Pulumi secret inputs encrypt state and redact previews;
workflow environment files must stay ephemeral and must never be printed or uploaded. See
[Vercel environment variable types](https://vercel.com/docs/environment-variables/sensitive-environment-variables).

The accepted provider credentials are:

| Provider | JSON names | Registration output |
| --- | --- | --- |
| Notion | `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET` | Public connection OAuth client id and secret |
| GitHub | `UIER_GITHUB_APP_ID`, `UIER_GITHUB_APP_SLUG`, `UIER_GITHUB_CLIENT_ID`, `UIER_GITHUB_CLIENT_SECRET`, `UIER_GITHUB_PRIVATE_KEY`, `UIER_GITHUB_WEBHOOK_SECRET` | GitHub App id, slug, OAuth pair, downloaded RSA private key and the matching webhook secret |
| Linear | `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET` | OAuth application's client id and secret |
| Slack | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_APP_ID`, `SLACK_DISTRIBUTION_APPROVED` | App/client ids, client secret and the explicit release gate (`"0"` or `"1"`) |

For example, a Notion-only map has this shape; replace placeholders through the owner's secret
manager or GitHub's repository-secret interface, not in a committed file:

```json
{
  "NOTION_CLIENT_ID": "<provider-issued client id>",
  "NOTION_CLIENT_SECRET": "<provider-issued client secret>"
}
```

Keep all desired provider entries when updating the map. Omit an unconfigured provider's entries;
empty placeholder strings are rejected. A GitHub PEM value uses JSON `\n` escapes for its line breaks.
Do not put this map, provider credentials or decrypted tokens in issues, logs, PRs or client props.
`UIER_DEPLOYMENT_ENV=production` is set by Pulumi separately. App configuration never accepts a
customer-supplied API host.

Pulumi automatically creates four stable 32-byte encryption keys and their `k1` ids:

| Credentials being encrypted | Production key name |
| --- | --- |
| Notion project grant | `NOTION_TOKEN_KEY` |
| Linear grant | `LINEAR_TOKEN_KEY` |
| Slack installation grant | `SLACK_TOKEN_KEY` |
| Temporary GitHub setup and PKCE receipts | `UIER_GITHUB_SETUP_KEY` |

No encryption key needs to be generated or copied by hand for initial setup. The four RandomBytes
resources are protected and remain registered while a provider is disabled or a rotation override is
active. Their outputs are not published as stack outputs. The initial preview without the credential map adds four
random-key resources and nine Vercel variables (four keys, four key ids and the deployment mode).
Each supplied credential adds one production variable; each previous-key pair adds two.

## Provider registration

Use applications owned by the service operator, uier's existing brand assets and actual support,
privacy and terms links. Production callbacks must match exactly. Use separate applications and
credentials for local testing; production credentials do not belong in `.env.local`.

### Notion

1. Register a **public connection** with installation scope **Any workspace**, rather than an internal
   connection. Configure `https://uier.io/app/notion/callback` as its production redirect URI.
2. Enable Read content, Insert content and Update content. Do not request unrelated user-information
   access. Verify the application identity and capabilities in the real portal before activation.
3. Record the OAuth client id/secret in the map. An optional duplicated template can contain the
   feedback database. Its first data source must have a title field and a separate rich text field
   named `uier id`; compatible optional fields can map automatically. The manual database/field picker
   remains available when template resolution fails.
4. Authorize from uier Settings, share the intended database with the connection and verify its field
   mapping. A template that resolves to a valid mapping can finish setup during authorization.

Notion documents [public authorization](https://developers.notion.com/guides/get-started/authorization)
and [connection capabilities](https://developers.notion.com/reference/capabilities). The adapter pins
`2026-03-11`, queries data sources with **POST**, and uploads screenshot bytes server-side. Notion now
has a [token revoke endpoint](https://developers.notion.com/reference/revoke-token), but uier disconnect
currently removes the local binding and credentials without calling it. Remove the connection in
Notion when provider-side revocation is required. Trashing a page does not permanently delete its
history or retained files.

### GitHub

1. [Register a public GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app),
   with repository **Metadata: read** and **Issues: read and write**. Do not add Contents, Actions,
   Pull requests, organization-member or email permissions. Customers choose selected repositories.
2. Register these distinct URLs:

   | Purpose | URL |
   | --- | --- |
   | Setup URL | `https://uier.io/app/github/setup` |
   | User authorization callback | `https://uier.io/app/github/callback` |
   | Lifecycle webhook | `https://uier.io/api/integrations/github/webhook` |

3. Configure the lifecycle events needed for installation and repository-access changes, plus user
   authorization revocation. Keep issue/comment content events disabled. Use the same webhook secret
   in GitHub and `UIER_GITHUB_WEBHOOK_SECRET`. Download the app's RSA private key and record the app
   id, slug and OAuth client pair using the exact names above.
4. Test organization approval and SSO. From uier, install the app, complete user authorization, load
   repositories and select a repository where the authorizing GitHub user is an admin. An
   `installation_id` or a successful install redirect alone does not authorize a uier destination.
   For an installation already connected to the current uier workspace, choose **Use account
   installation** in Settings. This starts fresh user authorization without reopening GitHub's
   installation page. Repository discovery and confirmation remain required for every project.

GitHub's [setup URL](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url)
and [user authorization](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
are separate stages. The picker uses a short-lived encrypted setup receipt; later delivery uses
repository-scoped installation tokens. This release does not upload screenshots to GitHub.

### Linear

1. Register a Linear OAuth application with exact callback
   `https://uier.io/app/linear/callback` and the provider's required application/consent details.
2. The implemented authorization requests `read,write`, S256 PKCE, `actor=app` and `prompt=consent`.
   Do not add admin, agent, assignable or mentionable capabilities for this mirror.
3. Record the client id/secret. A Linear workspace admin installs the app; choose a reachable team,
   optional project, different open/done workflow states and optional existing labels in uier.
4. Test private asset access with screenshots both enabled and disabled. Screenshots are an explicit
   setting; they are uploaded through authenticated server-side access rather than public uier URLs.

See [Linear OAuth](https://linear.app/developers/oauth-2-0-authentication) and
[app actor authorization](https://linear.app/developers/oauth-actor-authorization). Validate token
rotation, app-user identity and trash/restoration against a real installation before customer rollout.

### Slack notifications

1. Register a Slack app with exact OAuth redirect `https://uier.io/app/slack/callback`.
2. Use bot scopes `chat:write`, `channels:read` and `groups:read`. Do not add user scopes,
   `chat:write.public`, history/replies scopes, incoming webhooks, interactivity or the Events API.
3. Complete Slack's applicable distribution/approval requirements for the intended customer
   workspaces. Enable token rotation for the controlled test installation and verify it before production rollout.
   Keep `SLACK_DISTRIBUTION_APPROVED="0"` until that release decision is made; `"1"` is an owner
   assertion of completed distribution readiness, not an API check or automatic approval.
4. Record the app/client ids and client secret. Invite the bot to the chosen channel. uier does not
   join channels automatically. Test private-channel access, channel removal and reconnect.

See [Slack OAuth](https://docs.slack.dev/authentication/installing-with-oauth/) and
[token rotation](https://docs.slack.dev/authentication/using-token-rotation/). Slack receives bounded
notifications and selected-change counts, rather than complete discussions or screenshots. An
unconfirmed message create needs review; uier does not add history scopes or blindly resend it.

## CI preview and production activation

The scheduled worker also needs repository secret `UIER_COMMENTS_SECRET`, containing the existing
production app signing key. Vercel omits this Sensitive variable from environment downloads. An
authorized operator retrieves the current value privately from encrypted infrastructure state and
stores it as a GitHub Actions secret; do not generate a replacement, change the protected Vercel
variable or print the state. Refresh this copy whenever the production signing key rotates.
`process.loadEnvFile` preserves the job-supplied value over Vercel's empty downloaded placeholder.
The **Review notifications** manual workflow offers `integrations_only=true` to skip all email
delivery and email retries while checking provider progress. Combining it with `retry_delivery`
fails before any delivery.

1. The owner completes registration and stores the desired credential map. Review the exact CI Pulumi
   preview before merging or deploying. Only the new integration environment/key resources belong to
   this infrastructure change. Stop on any unrelated database, backup, domain, identity, email,
   deletion, replacement or protection change. Do not run `pulumi up` locally.
2. CI applies infrastructure before deploying the app on `main`. A passed preview or merged PR does
   not prove production variables or app credentials are effective. Verify the production deployment
   identity and configured/unconfigured Settings states without reading credentials back into logs.
3. On controlled fixtures, connect **two separate uier projects to the same external installation or
   workspace**, then exercise both. In particular, verify that a second Notion authorization does not
   invalidate the first project's token pair. If it does, keep Notion unavailable to customers until
   grant sharing is redesigned and tested. Check Linear/Slack installation-ownership boundaries and
   GitHub repository restrictions across the two projects.
4. Create shared feedback, edit/reply/delete a reply, change status and replace a screenshot where
   supported. Independently inspect the external object and the next worker result. Check names and
   links, current assignment where supported, duplicate prevention, and both projects after refresh.
5. Make the thread private, then visible, then hard-delete a separate fixture. Inspect reachable
   external copies, including previous destinations. A cleanup-blocked state means removal was not
   confirmed. Provider history, notifications, files and inaccessible copies remain separate limits.
6. Test disconnect, disabled sync, removed/demoted connecting admin, revoked provider access, changed
   repository/team/channel access, backfill caps and cross-provider progress under a rate limit.
   Confirm that unavailable providers make no network calls and that guest/public views expose no
   external links or provider metadata.
7. Record each provider's registration, deployment, worker and external readback evidence separately.
   Enable customer use only after its own real-installation checks pass. Local stubs, CI, merge and
   hosted acceptance are separate results.

Remaining operator actions are registration/approval, storing provider credentials, reviewing the
CI preview, deploying, and performing/recording these controlled live checks. This document is a
runbook; it does not claim those actions have occurred.

## Explicit key rotation

The credential map also accepts the four key names above and each key's `_ID`, `_PREVIOUS` and
`_PREVIOUS_ID` companions. Keys must be canonical base64 encodings of exactly 32 bytes. An explicit
current-key override requires its id; a previous key requires its previous id. Current and previous
ids must differ. Defaults remain `k1` when no override is supplied.

Rotation is an operator change, not a random-resource replacement. Prepare the new key through the
approved secret manager, retain the previous material securely, and update the full credential map
with both pairs. For example, rotate the Notion key from `k1` to `k2` by setting
`NOTION_TOKEN_KEY`, `NOTION_TOKEN_KEY_ID="k2"`, `NOTION_TOKEN_KEY_PREVIOUS` and
`NOTION_TOKEN_KEY_PREVIOUS_ID="k1"` together. Never label different active key material with the same
id. Do not print/export decrypted credentials or the key material to verify the change.

Review the preview for in-place environment value updates and the previous-pair additions; the
four protected generated-key resources must remain unchanged. After the deployment, prove old
ciphertext still decrypts through controlled grant use and new writes use the current id. Grant
refreshes can rewrite token pairs; dormant grants are not automatically re-encrypted. Retain the
previous key until every still-authorized grant has refreshed/reconnected or been deliberately
revoked, and short-lived OAuth/PKCE/setup receipts have expired. Do not remove the explicit current
key override afterward: that would select the original generated `k1` key again. A second rotation
requires draining or retiring ciphertext that still needs the older retained key first.

Removing credentials from the map disables future provider use after deploy; it does not revoke
provider tokens, erase external content or decrypt records for cleanup. Use the current admin's
Settings controls to turn sending off or disconnect even when provider credentials are unavailable,
and handle provider-side revocation/retention separately.

## Manual work remaining

- Register the four provider applications under the operator's account, configure the listed
  permissions and exact URLs, and complete each provider's consent/identity requirements. The
  available repository tools cannot perform those account-owner portal decisions.
- Store the provider-issued credentials in `UIER_INTEGRATION_ENV` and deploy that configuration
  through CI. The repository secret was absent when checked on 28 October 2026. Initial encryption
  keys are generated by Pulumi; provider credentials cannot be generated by uier.
- Complete Slack distribution approval and real rotating-token acceptance before setting its
  release gate to `"1"`.
- Run and record the controlled two-project acceptance checks above, including Notion token
  interoperability, grant rotation, provider permissions, screenshots, destination changes,
  privacy/deletion, uncertain-write recovery and independent progress. Inspect the actual external
  copies and scheduled worker outcome; local simulators and a deployment do not establish these facts.
- Review external retention/access with the connected account owner. Provider history, retained
  files, notifications, human discussion and inaccessible old copies need provider-side handling.

Ongoing unknown-send and malformed rate-limit holds deliberately require an operator's verified
decision. Use [integration operations](integration-operations.md); an empty search or a successful
local retry is not proof that an earlier external copy never existed.
