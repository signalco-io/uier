# uier documentation

Start with the [project README](../README.md) to run uier locally or find the main packages.

## Development

- [Local development and testing](development.md): setup, ports, local MCP OAuth, test categories, focused implementation checks and PR verification.
- [Contributing](../CONTRIBUTING.md): workflow, code conventions and documentation ownership.
- [Agent guides](../AGENTS.md): package code maps and implementation rules.
- [Brand guide](../packages/brand/BRAND.md) and [live brand page](https://uier.io/brand): voice, tokens, logo and components.

## Product and APIs

- [Toolbar guide](../packages/toolbar/README.md): embedding, modes and configuration.
- [Review workflow](review-workflow.md): the app, access, assignment, screenshots, drafts, unread activity and environments.
- [Teams and access](teams-and-access.md): team grants, external reviewers, invitations, revocation, history, limits and rollback.
- [API reference and toolbar delivery](api.md): review and public comments routes, limits, storage and bundle caching.
- [Coding tool access (MCP)](mcp.md): OAuth sign-in, connected apps, access tokens, client setup, tools, prompts and retry contracts.
- [MCP OAuth plan](mcp-oauth-plan.md): the design record for coding tool sign-in, the decisions taken and where the implementation differs.
- [Feedback context](feedback-context.md): the shared export packet used by Copy issue and MCP.
- [Connected services](integrations.md): Notion pages, GitHub and Linear issues, Slack notifications and the shared delivery protocol.

## Operations

- [Infrastructure and operations](operations.md): infrastructure setup, CI/CD, credentials, status checks and moderation.
- [CI credential rollout](ci-credential-rollout.md): staged least-privilege environments, build/deploy separation and production Cosmos DB identity access.
- [Backups and restore](backups-and-restore.md): policy rollout gates, access, recovery procedure and drill evidence.
- [Review notifications](review-notifications.md): email delivery, retention, scheduler and production acceptance gates.
- [Integration setup](integration-setup.md): provider registration, production credentials, activation and manual acceptance tasks.
- [Integration operations](integration-operations.md): inspect stopped delivery and explicitly reconcile uncertain writes.
- [MVP launch verification](mvp-launch-verification.md): coverage, measurements and outstanding hosted/device checks.
- [Pinned toolbar bundles](operations.md#pinned-toolbar-bundles): retention, API compatibility and rollback builds.

## Integration plans

These plans record the design for outbound integrations. Each records scope,
authorization, delivery and recovery rules, privacy limits, validation and release gates.

- [Notion](notion-integration-plan.md), including the shared provider architecture.
- [GitHub](github-integration-plan.md), for a one-way issue mirror.
- [Linear](linear-integration-plan.md), for a one-way issue mirror.
- [Slack notifications](slack-integration-plan.md), for project updates in a channel.

The shared connection, discovery, delivery and external-link contracts are defined in the
[Notion expansion model](notion-integration-plan.md#21-expansion-to-other-services).

The adapters and project settings are implemented. Availability still requires provider registration,
production credentials and provider-specific approval. The [implemented contract](integrations.md)
records behavior and limits; the plans retain their original phases and proposed acceptance gates.
