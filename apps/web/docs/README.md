# apps/web notes

One note per feature area: what it does, where the code is, the rules that apply only to it and
the tests that cover it. Rules for every change in `apps/web` are in [the web guide](../AGENTS.md).

Read the note for the area you change, not all of them. When a change alters an area's behaviour
or rules, update its note in the same pull request. A new area gets its own note and a line here.
Product contracts, API references and runbooks stay in the repository's [`docs/`](../../../docs/README.md).

## Public site

- [Brand page](brand-page.md): `/brand`, the live brand reference.
- [Landing page](landing-page.md): sections, copy rules, the how-it-works scene, pricing.
- [Feature pages](feature-pages.md): `/features/<feature>`, when to publish one and what each states.
- [Comparison pages](comparison-pages.md): `/compare`, sourced feature matrices, visual workflows and alternatives.
- [Integration pages](integration-pages.md): `/integrations` and provider pages, listing illustrations.
- [Guides](guides.md): `/guides` and the guides under it, their step layout and pictures.
- [Search indexing](search-indexing.md): metadata, sitemap, `noindex`, IndexNow.
- [Social cards](social-cards.md): page cards, app link previews, `/og/[card]`.
- [Footer](footer.md): `SiteFooter` and its links.
- [Legal documents](legal-documents.md): when a change needs the legal pages updated.
- [Security and open source pages](security-and-open-source-pages.md): `security.txt`, `/security`, `/open-source`.
- [Status page](status-page.md): `/status` and `/api/status`.
- [Page security](page-security.md): CSP, nonces, COOP, HSTS and the cookie name migration.

## The app

- [App languages](localization.md): supported languages, browser defaults, profile preference and catalogs.

- [App shell](app-shell.md): sidebar, sidebar project order, workspace area, project header, `ProjectMark`, projects list, My work.
- [Project settings](project-settings.md): settings sections, one save per page, notification settings.
- [Environments](environments.md): the site addresses table and environment filters.
- [Page checks](page-checks.md): the project's page check summaries from members' toolbars, their store and view.
- [Account](account.md): account sections and profile pictures.
- [Usage](usage.md): the account's and the workspace's Usage pages, and the toolbar's links to them.
- [First run, onboarding and installation](onboarding.md): welcome step, onboarding steps, installation check, snippets.
- [Projects](projects.md): public ids, addresses, deletion and transfer.
- [Clients](clients.md): client documents, names, appearance and visibility.
- [Page and mutation responsiveness](responsiveness.md): realtime refresh, URL state, optimistic updates, `LinkTabs` spinners.
- [Cache Components](cache-components.md): static shells, request-scoped authorization, cache boundaries and verification.
- [Keyboard navigation and shortcuts](keyboard.md): composites with one tab stop, the shortcuts, `?` and the switch.

## Comments and review

- [Comments inbox and board](comments-inbox.md): rows, keyboard, the board and drag and drop.
- [The open thread](comment-thread.md): `CommentCard`, message Markdown, reading when shown, the reply composer.
- [Comment query backend](comment-query.md): versioned queries, Cosmos execution, capabilities, cursors and saved views.
- [Comment filters and priority](comment-filters.md): the filter bar and `PriorityFlag`.
- [App triage](triage.md): search, priority and bulk triage.
- [In progress](in-progress.md): the In progress stage.
- [Fix verification](fix-verification.md): request, confirm, reject and cancel.
- [AI agents under the assignee](assignee-agents.md): `assigneeAgent`, its UI and MCP tools.
- [AI thread titles](ai-titles.md): `aiTitle`, the Haiku call, when titles are made and who sees them.
- [Read state and activity](read-state-and-activity.md): bounded thread history, read cursors, bulk read, adaptive refresh.
- [Review API and comment records](review-api.md): anchors on uier's pages, review SSO, edits, image replacement, page state.
- [Anchor updates](anchor-updates.md): reattaching a comment's anchor.
- [Project review briefs](project-review-briefs.md): the project brief.
- [Feedback export](feedback-export.md): the shared feedback context packet.
- [uier's feedback projects](public-feedback-project.md): the showcase, guests' and accounts' feedback, staff allowlist and public workspace.

## Accounts, access and sign-in

- [Sign-in](sign-in.md): email codes, Google, Microsoft, passkeys and the sign-in card.
- [Workspace access and membership](access-and-membership.md): teams, access writes, membership rules and email domains.

## Integrations, MCP and services

- [Integration foundation](integrations.md): outbox, delivery, status and reply sync, provider notes.
- [Authenticated MCP connector](mcp-connector.md): authentication, OAuth, protocol revisions and transport, tools, events and client setup.
- [Review notifications](notifications.md): events, digests, the scheduled worker and email reports.
- [Browser extension runtime](browser-extension.md): extension sessions, installation and the public pages.
- [Rewrite accounting](rewrite-accounting.md): rewrite usage telemetry and cost reports.

## Data and privacy

- [Cosmos query diagnostics](cosmos-queries.md): complete queries, counts and sampled diagnostics.
- [Privacy cleanup](privacy-cleanup.md): image re-encoding, cleanup intents and screenshot storage.
