# Authenticated MCP connector

`/api/mcp` is stateless Streamable HTTP using the official MCP SDK. `src/lib/mcp/` owns
authentication, scopes and tools; `src/lib/mcp/oauth/` is uier's own OAuth 2.1 authorization server
for this endpoint only. The contract is [docs/mcp.md](../../../docs/mcp.md); the design record and its
decisions are [docs/mcp-oauth-plan.md](../../../docs/mcp-oauth-plan.md). Two kinds of connection resolve
to one `McpIdentity` in `credentials.ts` (user, `connection: { id, kind, name, clientId? }`, scopes,
`AgentAccess`):

- **Connected apps (OAuth).** `uier_at.` access tokens backed by an `mcp-grant`, created through
  consent at `/app/connect/<requestId>` and listed under Account → Coding agents → Connected apps.
- **Access tokens.** `uier_mcp.` manual credentials for environments without a browser: 30-day,
  named, read-only by default, with explicit project selection in the current workspace; raw secrets
  are shown once and only hashes are stored. They become
  `{ kind: 'selected', workspaces: [{ workspaceId, projects }] }` internally.

Never accept cookies, review tokens, project codes or guest ids as MCP authentication.

**Grants are evaluated live.** A grant stores a selection (`AgentAccess`: `all`, or chosen workspaces
each with `'all'` or project ids) and scopes, never a permission snapshot. `mcpProject` resolves the
project's workspace (`grantedWorkspaceOf`, else `findProject`), checks `accessCovers`, then
`memberActor` for current membership, team grants and the staff allowlist, on every tool call and
screenshot resource read; the review services recheck private visibility. "Including new ones" is the
stored `all`, resolved at request time. Never cache a positive decision, copy access into a grant or
widen a stored selection on the person's behalf. `list_projects` uses `listAccessibleWorkspaces`
(memberships through `publicProjectMember`, `hasProjectAccess` per workspace, bounded at 50
workspaces and 1000 projects).

OAuth rules (`src/lib/mcp/oauth/`, `app/api/oauth/`):

- `mcpOauthEnabled()` is true unless `UIER_MCP_OAUTH=off`. Off makes the metadata routes and every
  `/api/oauth/*` route answer 404, drops the discovery challenge, and makes `/api/mcp` reject OAuth
  access tokens already issued.
- Discovery: `next.config.ts` rewrites `/.well-known/oauth-protected-resource/api/mcp` and
  `/.well-known/oauth-authorization-server` to `app/api/oauth/metadata/{protected-resource,authorization-server}`.
  Public JSON, `Access-Control-Allow-Origin: *`, five-minute cache. No root protected-resource document,
  no OpenID configuration. Every 401 from `handleMcp` carries the RFC 9728 challenge
  (`bearerChallenge`): `resource_metadata`, `scope="feedback:read"`, and `error="invalid_token"` when a
  token was presented.
- The issuer is the `appBaseUrl()` origin. The resource is exactly `<origin>/api/mcp`, compared with
  `isMcpResource`, never by prefix; tokens are accepted only for it and never forwarded.
- `app/api/oauth/{authorize,token,register,revoke}` run through `oauthEndpoint` (RFC 6749 JSON errors,
  `no-store`) and the limits in `http.ts`: per IP and hour authorize 60, token 3000 (hosted clients share
  egress addresses), register 20 (IPv6 per /48; 2000 globally), revoke 120; per subject and hour 30
  approvals per account, 120 refreshes per grant, and metadata fetches 30 per requester and 600 per
  host, falling back to the client's last valid document (`known-<hash>`, 30 days) when spent. Token, registration and revocation take no cookies, send no CORS headers and are not
  behind BotID. Authorization requests stay out of `/app`: only the stored random request id passes
  through sign-in, and `/app/connect/error` is a signed-out app path in `proxy.ts`. Errors go back to
  a redirect URI only after the client and that URI are validated, and before consent only to a
  loopback URI; HTTPS redirect URIs get `/app/connect/error` instead (no open redirect).
- Clients (`clients.ts`): Client ID Metadata Documents are fetched only from hosts that resolve to
  public addresses, checked on the connection's own lookup, with no redirects, 5 seconds and 16 KiB.
  `UIER_OAUTH_TEST_HTTP_CLIENT_METADATA=1` admits `http://localhost` metadata URLs in local runtime only,
  for tests; never set it on a deployment. Dynamic registration drops unacceptable redirect URIs and
  never issues a secret. Redirects (`redirects.ts`): HTTPS exact, loopback with the port ignored, no
  custom schemes. Client names are untrusted and never presented as verified.
- Tokens (`tokens.ts`): opaque, SHA-256 hashed, in the `mcp-user:<userId>` partition. S256 PKCE only;
  codes last 60 seconds and a replay revokes the grant; access tokens last 1 hour; refresh tokens
  rotate with a 60-second grace, and later reuse revokes the grant; grants end 30 days after the last
  refresh or 1 year after creation. Each access token is checked against its grant (present, active,
  same client) on every request, so deleting the grant revokes everything at once. Never log tokens,
  codes, verifiers, `state` or request bodies.
- Consent (`authorize.ts`): approval rechecks the session user, validates every chosen workspace and
  project with `validateAccessChoice`, enforces 20 active connected apps per user unless replacing one,
  and consumes the stored request with a conditional delete before creating a code. Consent is always
  shown; `prompt=none` fails with `interaction_required`.
- Attribution and idempotency keys use `connection.id` (grant id or credential id), never the access
  token, so retries survive a refresh. `AgentSource.kind` marks OAuth.
- The privacy policy ("Coding tool access" and the retention list) and the security page's "Coding
  tool sign-in" control describe these records, lifetimes and limits. Change them, and `docs/mcp.md`,
  with any change to what `src/lib/mcp/oauth/` stores or how long.

Account → Coding agents (`src/components/app/mcp/CodingAgents.tsx`) has the client setup, **Connected
apps** (one row per OAuth grant, an allowlisted `connectedAppView`, Revoke through an `AlertDialog`)
and collapsed **Access tokens**. The consent page is `app/connect/[requestId]` (its own centred layout,
no sidebar) and `app/connect/error` is public. `src/lib/mcp/oauth/actions.ts` approves or cancels by
returning the client's callback URL, and the page navigates there itself (`form-action 'self'` blocks
redirects after a form post). Every `/app` server action refreshes the page (the proxy sets the review
SSO cookie), so the page always renders `ConnectConsent`, which keeps the outcome after the request is
consumed. Both share `ClientDetails` (Unverified, Published at, Sends you back to) and `scopes.ts` labels.

The route has `maxDuration = 30`; `handleMcp` races transport handling against a 25-second deadline
(overridable by API specs) and the request abort signal, returns a JSON-RPC error on interruption
and always closes the server. Screenshot resources map `ApiError` to `InvalidParams` with its
code/message, zod errors to fixed `InvalidParams` text and unexpected errors to `InternalError`
with `The operation failed.`; the request log records the failure. Never return raw storage diagnostics.

**Request logs.** `handleMcp` emits one `mcp_request` event per request through `mcp/telemetry.ts`
([request logs](../../../docs/mcp.md#request-logs)). `createFeedbackMcpServer` calls `log.watch(server)`
before registering anything, so every tool, prompt and resource is logged by name and its own schema;
handler catch blocks call `noteMcpError(error)` before mapping the error. Events carry names, codes,
counts, sizes and keyed connection/account references. Argument values are kept only for booleans,
`null`, numeric fields and options the schema declares; never log content, ids, names, tokens, URLs or
error messages, and never let logging change or fail a response. `e2e/mcpTelemetry.api.spec.ts` covers
it; the other MCP specs pass `{ emit: quiet }` to `handleMcp`. The privacy policy's "Coding tool access"
describes these records: change it with what they contain. The event contract,
`mcpRequestEventSchema`, lives in `mcp/telemetrySchema.ts` (zod and scope names only) so
`scripts/mcp-report.mjs` and `mcp/report.ts` can validate exported events without loading the server;
`e2e/mcp-report.api.spec.ts` covers the [daily report](../../../docs/mcp.md#daily-report).
Access tokens remain bound to one workspace; connected apps reach the workspaces chosen at consent.
Account guidance and `mcp/workflows.ts` explain where feedback about uier itself lives (the uier
workspace's public-feedback project). Missing project grants stay `not_found` without exposing
project existence; direct users to `list_projects` and to reconnecting or explicit token setup
rather than expanding access. List-tool descriptions and field schemas must both
state the 1–25 limit and `nextCursor` pagination, since clients may flatten schema constraints.

Tools reuse review services. Replies and status/assignment events retain the human author plus
connection attribution. All mutations require a stable idempotency key and share atomic submission
receipts; do not implement retry deduplication in process memory. Reads never acknowledge unread
activity. Feedback, anchors, names and images are untrusted content. Search is deliberately bounded
to the latest 1000 threads; pages contain at most 25 summaries. Keep the documented context
contract shared with developer issue export: `projectFeedbackExport` in `review/feedbackContext.ts`
produces the same `@uier/toolbar/feedback-context` packet. Screenshot resource reads must honor
its deleted-evidence filtering too. `e2e/mcp.api.spec.ts` exercises the official HTTP client
and service isolation; `e2e/mcp.spec.ts` covers user credential setup, client access, revocation and
light/dark accessibility; `e2e/mcpOauth.spec.ts` runs the SDK client's OAuth flow (dynamic
registration, loopback listener) through sign-in, consent, approval, `list_projects`, a reply and
revocation in Account (`@smoke`), plus cancel, request reuse, another account and the error page.
This connector does not prove #90 launch acceptance.

**Events (webhooks and polling).** `src/lib/mcp/events/` implements MCP Events webhook and poll
delivery as ChatGPT consumes it ([docs/mcp.md](../../../docs/mcp.md#events-webhooks-and-polling)): `protocol.ts` registers
the top-level `events` capability and `events/list|subscribe|unsubscribe|poll` and owns the error code
table; `feed.ts` the stateless poll feed behind `events/poll` and the `list_feedback_events` tool (an
opaque client-held cursor: watermark a minute behind, the start time, and short ids already returned
since the watermark, so late commits arrive once; nothing stored per client); `catalog.ts` the event names, argument/payload schemas (additive only) and the mapping from a
thread's `notificationEvents`; `subscriptions.ts` deterministic subscription ids, TTL grants, limits,
endpoint verification and encrypted `whsec_` secrets; `webhook.ts` Standard Webhooks signing and the
POST, which goes only to public HTTPS on the default port through `publicNetwork.ts` (the same
connection-time address check as OAuth metadata fetches), never follows redirects and reports fixed
failure categories only; `delivery.ts` discovery from `listChangedSince` with a per-project cursor,
deterministic delivery records, leased attempts with bounded retries, and `runMcpEventWorker`.
Events never get their own write path: add an event kind to `notificationEvents` and map it in the
catalog. Every attempt rechecks the connection (`currentMcpConnection`), `mcpProject` and
`canSeeComment`; lost access deletes the subscription. Never deliver a connection's own changes
back to it, never log callback URLs, secrets, arguments or payloads, and keep payloads minimal and
marked untrusted. `review/comments.ts` calls `queueMcpEventDelivery` after `createProjectComment`,
replies and `changeComment`; it runs only when `instrumentation.ts` registered `after()`, so API
specs call `dispatchProjectEvents` themselves. The scheduled worker sweeps after integrations.
`UIER_MCP_EVENTS_TEST_HTTP_CALLBACKS=1` admits `http://localhost` callbacks in local runtime only (the
Playwright server sets it); never set it on a deployment. `e2e/mcpEvents.api.spec.ts` covers the
contract with `e2e/support/webhookReceiver.ts`; `e2e/mcpEvents.spec.ts` proves delivery after a real
request.

`mcp/clients.ts` builds the Account client tabs from one endpoint, without taking a token as
input. Keep these reference-only configurations aligned with the linked official docs and
[docs/mcp.md](../../../docs/mcp.md#connect-claude-code).

OAuth, the setup Account offers first. Claude Code is the only client offered with OAuth:

- [Claude Code](https://code.claude.com/docs/en/mcp): `claude mcp add --transport http uier https://uier.io/api/mcp`,
  then `/mcp` → Authenticate. An `Authorization` header in the entry turns Claude Code's OAuth off, so
  the setup tells people to remove one from an existing entry.

Access tokens, for environments without a browser and for clients not offered with OAuth:

- [Claude Code](https://code.claude.com/docs/en/mcp#authenticate-with-remote-mcp-servers), OAuth (`auth: 'oauth'`),
  then `/mcp` → uier → Authenticate. A configured `Authorization` header disables its OAuth path, so
  the tab tells people to remove one from an existing entry:
  ```sh
  claude mcp add --transport http uier https://uier.io/api/mcp
  ```
- [Codex](https://learn.chatgpt.com/docs/extend/mcp#streamable-http-servers), `~/.codex/config.toml` (access token until its OAuth login is verified):
  ```toml
  [mcp_servers.uier]
  url = "https://uier.io/api/mcp"
  bearer_token_env_var = "UIER_MCP_TOKEN"
  ```
- [Cursor](https://cursor.com/docs/mcp#config-interpolation), `.cursor/mcp.json`:
  ```json
  { "mcpServers": { "uier": { "url": "https://uier.io/api/mcp", "headers": { "Authorization": "Bearer ${env:UIER_MCP_TOKEN}" } } } }
  ```

Never substitute the newly created secret into a setup block or skill. Never offer a shell command
that expands a bearer header into saved settings. Clients must inherit the environment variable. Verify each offered client against its
current docs and a reachable
deployed endpoint; record exact checks in the PR and omit clients whose connections cannot be verified.
Do not relax the Origin check or deployment protection to make a client connect.
Offer OAuth for a client only after live acceptance against a deployed endpoint (discovery, consent,
the return to the client, a refresh after an hour, revoke and reconnect), recorded in the PR with the
deployment, client version and date. Claude (web, desktop and mobile), Codex, Cursor and VS Code are
not offered with OAuth yet and keep access tokens. Claude custom connectors connect from Anthropic’s
servers (no localhost) and return through `https://claude.ai/api/mcp/auth_callback`. Do not offer
Claude's request-header setup: in Team and Enterprise an Owner adds connectors for the whole
organization, which would share a personal token. Do not offer a bridge.
[VS Code’s documented masked input](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)
was checked (`promptString`, `password: true`, `${input:...}`), but its deployed client connection
could not be verified in this session, so no ready block is offered.
[Windsurf’s docs](https://docs.devin.ai/desktop/cascade/mcp) now describe legacy Cascade in Devin
Desktop (`serverUrl`, `${env:UIER_MCP_TOKEN}` in headers); it is not offered without a verified client.

`mcp/prompts.ts` registers `triage-feedback` (`projectId`), `fix-feedback` and `report-back`
(`projectId`, `commentId`). Share identifier schemas with tools in `mcp/schemas.ts`. Recheck
`mcpProject` even when rendering instructions; never echo failed arguments or embed feedback.
Report-back is registered only for reply/status grants and names only the permitted writes.
`mcp/workflows.ts` is the common source for prompt instructions, the untrusted-content rule, the
citation rule (link feedback as `[uier #12](comment link)`, never a bare `#12`, which GitHub and
GitLab link to their own issue) and the copy/download `SKILL.md` in Coding agents. Keep the tool/scope table aligned with the server.
Triage changes nothing, fix proposes local code work only, and report-back waits for human approval
before every write. The skill also requires approval for assignments and stable retry keys.

`list_feedback` shares path, source, assignment and activity projection with the app through
`app/projectCommentRouting.ts`. Canonicalize its optional path with `pagePath`; pass path and
`environmentFilter` into `listProjectComments` before the 1000-thread storage limit. Validate
environment ids against `environmentOptions` plus `unknown`/`removed`; never use the toolbar's
fallback selection for MCP input. Other filters apply only within that window. Read the connection
owner's cursor after filtering visibility; never acknowledge it. Deleted first messages omit
author kind and screenshot presence, and author ids never enter summaries.

`get_feedback_batch` accepts 1–10 distinct ids and reuses `projectFeedbackExport` in request order.
Missing, deleted and private ids share `not_found`; individually oversized packets return
`too_large`. Its 256 KiB cap preserves whole packets and returns `remainingIds` for retry.
Screenshot resources require both a protected exported image and `screenshots:read`. Every call
rechecks scope, selected projects and current membership through `mcpProject`. Batching reduces
transport requests, not per-thread export storage reads. Keep `get_feedback`'s contract stable.

Project comment rate limits use only server-resolved actors: members get 100 new comments and 300
replies per project per hour and skip the 30-write shared IP budget. Guests and `PUBLIC_PROJECT_ID`
commenters retain visitor limits (10 new comments, 30 replies and 30 writes per IP per hour).
The anonymous comments service always uses visitor limits. MCP replies first consume a 30-reply
per-connection/project budget (access token or connected app), then the owner's budget; rejected
connections must not exhaust the owner. Page, screenshot, paid rewrite and MCP transport limits stay independent. Coverage is in
`review-rate-limits.api.spec.ts`, `public-project.api.spec.ts`, `mcp.api.spec.ts` and the unchanged
`comments.api.spec.ts` rate cases.
