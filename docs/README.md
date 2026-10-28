# uier documentation

Start with the [project README](../README.md) to run uier locally or find the main packages.

## Development

- [Local development and testing](development.md): setup, environment variables, commands, ports and test coverage.
- [Contributing](../CONTRIBUTING.md): workflow, code conventions and documentation ownership.
- [Agent guides](../AGENTS.md): package code maps and implementation rules.
- [Brand guide](../packages/brand/BRAND.md) and [live brand page](https://uier.io/brand): voice, tokens, logo and components.

## Product and APIs

- [Toolbar guide](../packages/toolbar/README.md): embedding, modes and configuration.
- [Review workflow](review-workflow.md): the app, access, assignment, screenshots, drafts, unread activity and environments.
- [API reference and toolbar delivery](api.md): review and public comments routes, limits, storage and bundle caching.
- [Coding tool access (MCP)](mcp.md): credentials, client setup, tools, prompts and retry contracts.
- [Feedback context](feedback-context.md): the shared export packet used by Copy issue and MCP.
- [Shared integration foundation](integrations.md): durable source outboxes, bounded discovery, independent delivery, credentials and safe links.

## Operations

- [Infrastructure and operations](operations.md): infrastructure setup, CI/CD, credentials, status checks and moderation.
- [Backups and restore](backups-and-restore.md): policy rollout gates, access, recovery procedure and drill evidence.
- [Review notifications](review-notifications.md): email delivery, retention, scheduler and production acceptance gates.
- [MVP launch verification](mvp-launch-verification.md): coverage, measurements and outstanding hosted/device checks.

## Integration plans

These are implementation plans for outbound integrations, not shipped features. Each records scope,
authorization, delivery and recovery rules, privacy limits, validation and release gates.

- [Notion](notion-integration-plan.md), including the shared provider architecture.
- [GitHub](github-integration-plan.md), for a one-way issue mirror.
- [Linear](linear-integration-plan.md), for a one-way issue mirror.
- [Slack notifications](slack-integration-plan.md), for project updates in a channel.

The shared connection, discovery, delivery and external-link contracts are defined in the
[Notion expansion model](notion-integration-plan.md#21-expansion-to-other-services).

The shared foundation is implemented. Its provider registry stays empty until each complete adapter
ships; provider connections remain planned.
