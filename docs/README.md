# uier documentation

Start with the [project README](../README.md) to run uier locally or find the main packages.

## Development

- [Local development and testing](development.md): setup, ports, local MCP OAuth, test categories, focused implementation checks and PR verification.
- [Contributing](../CONTRIBUTING.md): workflow, code conventions and documentation ownership.
- [Agent guides](../AGENTS.md): package code maps and implementation rules.
- [uier monitor](uier-monitor.md): the agent skill that resolves a uier project's feedback end to end, its watcher token and this repository's notes for it.
- Feature notes for [apps/web](../apps/web/docs/README.md) and [packages/toolbar](../packages/toolbar/docs/README.md): one file per area, read the one for the area you change.
- [Brand guide](../packages/brand/BRAND.md) and [live brand page](https://uier.io/brand): voice, tokens, logo and components.
- [GitHub presence](github-presence.md): repository details, social preview assets and the signalco company profile.

## Product and APIs

- [Toolbar guide](../packages/toolbar/README.md): embedding, modes and configuration.
- [Browser extension](browser-extension.md): the published desktop extension's design, security boundaries, local loading, receipts and public pages.
- [Extension releases](browser-extension-release.md): protected release/status CI, owner bootstrap and recovery.
- [Firefox and Safari releases](browser-extension-firefox-safari-release.md): native CI, publisher setup, signing, submission and recovery; [reviewer source](browser-extension-source.md) explains reproducible builds.
- [Extension listing](browser-extension-listing.md): prepared copy, artwork and disclosure worksheet.
- [Review workflow](review-workflow.md): the app, access, assignment, AI thread titles, screenshots, drafts, unread activity and environments.
- [Teams and access](teams-and-access.md): team grants, external reviewers, invitations, email domains, revocation, history, limits and rollback.
- [Project deletion](project-deletion.md): what deleting a project removes, in what order, what stays and how failed steps are retried.
- [Project transfer](project-transfer.md): moving a project to another workspace, what moves with it, what stays behind and how an interrupted move is retried.
- [Screenshot storage](screenshot-storage.md): private Azure Blob bytes, direct reads, migration and cleanup.
- [API reference and toolbar delivery](api.md): review and public comments routes, limits, storage and bundle caching.
- [Google sign-in](google-sign-in.md): Sign in with Google, account linking rules, what is stored and creating the Google OAuth client.
- [Microsoft sign-in](microsoft-sign-in.md): Microsoft login, inbox confirmation, tenant identity and Entra app registration.
- [Coding tool access (MCP)](mcp.md): OAuth sign-in and consent, connected apps, access tokens, client setup, tools, prompts and retry contracts.
- [MCP OAuth plan](mcp-oauth-plan.md): the design record for coding tool sign-in, the decisions taken and where the implementation differs.
- [Feedback context](feedback-context.md): the shared export packet used by Copy issue and MCP.
- [Connected services](integrations.md): Notion pages, GitHub and Linear issues, Azure DevOps work items, Slack notifications and the shared delivery protocol.

## Operations

- [Search discovery](search-discovery.md): search console proofs, IndexNow deployments, public guides and disabled analytics status.
- [Infrastructure and operations](operations.md): infrastructure setup, CI/CD, credentials, security disclosure, status checks and moderation.
- [CI credential rollout](ci-credential-rollout.md): staged least-privilege environments, build/deploy separation and production Cosmos DB identity access.
- [Live rewrite evaluation](rewrite-evaluation-2026-11-02.md): bounded Opus/Sonnet measurements, provisional quality screen and accounting limits.
- [Rewrite usage and costs](rewrite-costs.md): daily operational reports, versioned estimates, accounting limits and model evaluation evidence.
- [AI thread title costs](ai-title-costs.md): the Haiku request, price estimates, what bounds the calls, usage events and how to turn titles off.
- [Backups and restore](backups-and-restore.md): policy rollout gates, access, recovery procedure and drill evidence.
- [Cosmos query costs](cosmos-query-costs.md): operation inventory, bounded profiling, measured RU results and query/count contracts.
- [Review notifications](review-notifications.md): email delivery, retention, scheduler and production acceptance gates.
- [Integration setup](integration-setup.md): provider registration, production credentials, activation and manual acceptance tasks.
- [Integration activation](integration-activation.md): application ownership, deployment receipts and controlled live acceptance evidence.
- [Integration publication](integration-publication.md): public setup materials, directory drafts and provider review gates.
- [Integration operations](integration-operations.md): inspect stopped delivery and explicitly reconcile uncertain writes.
- [MVP launch verification](mvp-launch-verification.md): coverage, measurements and outstanding hosted/device checks.
- [Pinned toolbar bundles](operations.md#pinned-toolbar-bundles): retention, API compatibility and rollback builds.

## Integration plans

These plans record the design for outbound integrations. Each records scope,
authorization, delivery and recovery rules, privacy limits, validation and release gates.

- [Notion](notion-integration-plan.md), including the shared provider architecture.
- [GitHub](github-integration-plan.md), for a one-way issue mirror.
- [Linear](linear-integration-plan.md), for a one-way issue mirror.
- [Azure DevOps](azure-devops-integration-plan.md), for a one-way Azure Boards work item mirror.
- [Slack notifications](slack-integration-plan.md), for project updates in a channel.

The shared connection, discovery, delivery and external-link contracts are defined in the
[Notion expansion model](notion-integration-plan.md#21-expansion-to-other-services).

The adapters and project settings are implemented. Availability still requires provider registration,
production credentials and provider-specific approval. The [implemented contract](integrations.md)
records behavior and limits; the plans retain their original phases and proposed acceptance gates.
