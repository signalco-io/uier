# infra - agent guide

The Pulumi program for project `uier`, stack `organization/uier/uier-production`. It is a
standalone pnpm project (own `package.json` and lockfile), deliberately outside the workspace
so web development never installs Pulumi dependencies.

It manages:

- the Vercel project `uier` (root directory `apps/web`, Node 24, region `dub1`) with the
  domains `uier.io` and `www.uier.io` (a `308` redirect to `uier.io`), and the comments API
  variables (production: `COSMOSDB_CONNECTION_STRING` with the primary key and `comments`,
  preview: the managed identity below and `comments-preview`, each its own `UIER_COMMENTS_SECRET`),
  the app's `COSMOSDB_APP_CONTAINER` (`app` / `app-preview`) and, for production only, the email
  variables `ACS_CONNECTION_STRING` and `UIER_EMAIL_SENDER`, and `ANTHROPIC_API_KEY` (rewrite
  suggestions) when the repository secret `ANTHROPIC_API_KEY` is set (passed to Pulumi as env);
- the Cloudflare DNS records for `uier.io` and `www.uier.io` (DNS only, not proxied);
- the Azure resource group with a serverless Cosmos DB account (database `uierdata`,
  containers `comments` and `comments-preview` partitioned by `/domain`, `app` and
  `app-preview` partitioned by `/pk`) and Azure Communication Services Email with an
  Azure-managed sender domain (`src/email.ts`).

Preview deployments get no account key: they use a user-assigned managed identity that trusts
the Vercel OIDC token of the project's preview deployments (federated identity credential) and
has the built-in Data Contributor role on `comments-preview` and `app-preview` only (and no
email key). Never give previews a
connection string again; the federated credential hardcodes the Vercel team slug, project name
and team issuer mode, so update it when those change.

The toolbar bundle needs no infrastructure of its own: the web app serves it at
`https://uier.io/toolbar.js` from Vercel's CDN.

## Rules

- **CI applies changes.** Pull requests get a `pulumi preview` posted as a comment; pushes to
  `main` run `pulumi up` before the website deploys. Do not run `pulumi up` locally.
- Data-holding and domain-serving resources are `protect`ed; a change that would delete or
  replace one fails on purpose. Do not remove `protect` to make a change go through.
- No credentials in config or code: Pulumi, the state backend and the secrets provider use
  the current Azure login (GitHub OIDC in CI, `az login` locally); Vercel and Cloudflare tokens
  come from `VERCEL_API_TOKEN` and `CLOUDFLARE_API_TOKEN`, the Anthropic key from `ANTHROPIC_API_KEY`
  (repository secrets passed in by `.github/workflows/pulumi_reusable.yml`).
- Pulumi runs the compiled `dist/index.js` (`typescript: false`), so build before a preview:
  `pnpm preview` does both.
- Keep the Pulumi CLI version pinned in `.github/workflows/pulumi_reusable.yml` equal to
  `@pulumi/pulumi` in `package.json`.

The README's "Infrastructure" section has the full setup, role assignments and the OIDC
subjects CI uses.


## Email rollout (#132)

`src/email.ts` first provisions a protected customer-managed `uier.io` domain and Domain/SPF/DKIM/
DKIM2/DMARC DNS records from `verificationRecords`. The existing Azure-managed domain, communication
service name, connection string and sender remain. DNS preflight found no apex SPF or `_dmarc` TXT
on 28 October 2026; recheck authoritative DNS and import/merge any externally created policy before
applying. Never add a duplicate SPF or DMARC record.

The report receiver's credential, expected subscription name and ACS topic are production-only.
Deploy the receiver before adding an Event Grid subscription in a later PR; Pulumi runs before
Vercel and subscription creation immediately calls the validation handshake. Event Grid must be
registered. Deliver the credential as a secret static HTTP header, never a query parameter.

One-time Azure verification checks the provisioned DNS; it is not a sender cutover. Read all five
live `verificationStates` until `Verified`. Link and switch only in a separate reviewed PR, using
a fresh `getDomainOutput` guard. Keep the Azure-managed domain linked. The preview must update
`linkedDomains` in place and must not replace the communication service or change its key/connection
string. Never remove protection or apply infrastructure manually. README Infrastructure documents
the exact sequence; `docs/review-notifications.md` tracks production evidence. Keep ledger matching
disabled until an authorized production digest proves report `messageId` equals its send operation
id; then enable `UIER_EMAIL_REPORT_MATCH_OPERATIONS=1` for production through Pulumi.
