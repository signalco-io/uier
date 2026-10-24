# infra - agent guide

The Pulumi program for project `uier`, stack `organization/uier/uier-production`. It is a
standalone pnpm project (own `package.json` and lockfile), deliberately outside the workspace
so web development never installs Pulumi dependencies.

It manages the Vercel project `uier` (root directory `apps/web`, Node 24, region `dub1`, the
`uier.io` domain, the comments API environment variables), the Cloudflare DNS record for
`uier.io`, and the Azure resource group with a serverless Cosmos DB account (database
`uierdata`, containers `comments` and `comments-preview` partitioned by `/domain`).

Production reaches Cosmos DB with the account's primary key. Preview deployments get no account
key: they use a user-assigned managed identity that trusts the Vercel OIDC token of the project's
preview deployments (federated identity credential) and has the built-in Data Contributor role on
`comments-preview` only. Never give previews a connection string again; the federated credential
hardcodes the Vercel team slug, project name and team issuer mode, so update it when those change.

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
