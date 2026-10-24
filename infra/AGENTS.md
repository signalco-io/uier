# infra - agent guide

The Pulumi program for project `uier`, stack `organization/uier/uier-production`. It is a
standalone pnpm project (own `package.json` and lockfile), deliberately outside the workspace
so web development never installs Pulumi dependencies.

It manages:

- the Vercel project `uier` (root directory `apps/web`, Node 24, region `dub1`) with the
  domains `uier.io` and `www.uier.io` (a `308` redirect to `uier.io`), and the comments API
  variables (production: `COSMOSDB_CONNECTION_STRING` with the primary key and `comments`,
  preview: the managed identity below and `comments-preview`, each its own `UIER_COMMENTS_SECRET`);
- the Cloudflare DNS records for `uier.io` and `www.uier.io` (DNS only, not proxied);
- the Azure resource group with a serverless Cosmos DB account (database `uierdata`,
  containers `comments` and `comments-preview`, both partitioned by `/domain`).

Preview deployments get no account key: they use a user-assigned managed identity that trusts
the Vercel OIDC token of the project's preview deployments (federated identity credential) and
has the built-in Data Contributor role on `comments-preview` only. Never give previews a
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
  come from `VERCEL_API_TOKEN` and `CLOUDFLARE_API_TOKEN`.
- Pulumi runs the compiled `dist/index.js` (`typescript: false`), so build before a preview:
  `pnpm preview` does both.
- Keep the Pulumi CLI version pinned in `.github/workflows/pulumi_reusable.yml` equal to
  `@pulumi/pulumi` in `package.json`.

The README's "Infrastructure" section has the full setup, role assignments and the OIDC
subjects CI uses.
