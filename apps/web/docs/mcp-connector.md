# Authenticated MCP connector

`/api/mcp` is stateless Streamable HTTP using the official MCP SDK. `src/lib/mcp/` owns
authentication, scopes and tools; `src/lib/mcp/oauth/` is uier's own OAuth 2.1 authorization server
for this endpoint only. The contract is [docs/mcp.md](../../../docs/mcp.md); the design record and its
decisions are [docs/mcp-oauth-plan.md](../../../docs/mcp-oauth-plan.md). Two kinds of connection resolve
to one `McpIdentity` in `credentials.ts` (user, `connection: { id, kind, name, clientId? }`, scopes,
`AgentAccess`):

- **Connected apps (OAuth).** `uier_at.` access tokens backed by an `mcp-grant`, created through
  consent at `/app/connect/<requestId>` and listed under Account → Coding agents → Connected apps.
- **Access tokens.** `uier_mcp.` credentials for environments without a browser: 30-day,
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

Account → Coding agents (`src/components/app/mcp/CodingAgents.tsx`, one region named Coding agents) is five
`Section` cards: **Connected apps** (one row per OAuth grant, an allowlisted `connectedAppView`, Revoke through an
`AlertDialog`; with none, an `Empty` state links to the setup card at `#connect`), **Install the uier plugin**
(separate Claude Code/Codex plugin tabs with marketplace and install commands), **Connect a coding tool** (the
endpoint, then numbered steps in a tab per client, each tab with its agent's mark, and Other clients), collapsed
**Access tokens** (the shadcn `Field` form; its state lives above the collapsible, so a secret shown once stays on
screen when the card is closed and opened again) and **Prompts and agent skill**. Connected apps and access tokens
share one row, `ConnectionItem` in `ConnectionSummary.tsx`: the agent's `AgentAvatar`, the name and where it comes
from (an app's client facts, a token's "Created by <connection>"), Revoke as a ghost button, then what it can reach (`ConnectionReach`), one chip per operation
(`ScopeBadges`: an eye for reading, a pencil for a change in uier; read as a list with commas) and the dates as
relative times with the exact time on hover. `ConnectionAvatar` runs `inferAgentKind` on each hint in order and takes
the first known agent: an app's own name and published host before the connection name, a token's name, else the
generic bot. Names are untrusted, so the mark is only a picture: it grants nothing, and Unverified stays beside an app
that named itself. The consent page is `app/connect/[requestId]` (its own centred layout,
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

**Creating access tokens through MCP.** `tokens:create` ("Create access tokens") is an explicit
operation in consent and Account's operations list. Consent leaves it off even when requested;
Select all operations includes it. Existing grants keep their stored scopes. `create_access_token`
(`createAccessToken.ts`) requires that permission, a name, `workspaceId`, 1–20 distinct explicit
`projectIds`, scopes, `days` (integer 1–30) and an `idempotencyKey`. It checks every project with
`mcpProject`, including current membership, and rejects scopes absent from the authenticating token
(including a narrowed OAuth access token). The issued token can never contain `tokens:create` or
future/all-project selections. It is an ordinary independently revocable credential; revoking its
creator can also revoke its created tokens (checked by default in the connection revoke dialog).
Unchecking leaves them independently active. Expiry is capped at the creating Account token’s expiry
or the OAuth grant’s hard expiry; current project/membership checks still apply.

Creation is limited by durable counters to 5 per connection and 10 per account per hour. A per-account
guard (counter only, 90-day TTL refreshed on writes) serializes hand-made and MCP creation at the shared 20-active-token limit. One app-container
transaction writes the credential hash and a `mcp-credential-creation` receipt/audit in the owner's
partition: input hash, credential metadata, creation/expiry and creating connection. The receipt
expires after 30 days, also when the token was revoked sooner. No secret is stored. Concurrent calls
or later retries with the same key return metadata only (`alreadyCreated: true`); changed input
conflicts. Only the winning response contains `token`. A lost first response requires revoking that
token before deliberately requesting a replacement. Account receives only the creator's display name
and labels the token "Created by <connection>". Request telemetry records tool outcome and shapes,
never the secret or name. `e2e/mcpAccessTokens.api.spec.ts` covers validation, authorization, live
access, limits, atomicity, retries and secret-free audit/logs; OAuth API coverage includes narrowed
scopes and refresh. The OAuth browser journey proves opt-in, account provenance and revocation.
Account guidance and `mcp/workflows.ts` explain where feedback about uier itself lives (the uier
workspace's public-feedback project). Missing project grants stay `not_found` without exposing
project existence; direct users to `list_projects` and to reconnecting or explicit token setup
rather than expanding access. List-tool descriptions and field schemas must both
state the 1–25 limit and `nextCursor` pagination, since clients may flatten schema constraints.

Assignment reads add `assignees[]` and per-person `agents[]`, with the first entry mirrored into
`assignee` / `agent`. `assign_feedback` accepts exactly one of legacy `assigneeId` (replace with one,
null clears all) or `assigneeIds` with optional `mode: replace | add | remove`. Add/remove are atomic.
`set_feedback_agent` adds optional `add: true` for another attachment and `agentId` for an existing
one; clear and working tools accept `agentId` too. Every agent operation is scoped to the caller's
own assignment, never another person's. Default set/clear target the first agent under the caller;
default working selects the unique attached connection/session. Agent results add `assigneeIds`
and the caller's `agents`, each with a stable `id`. Assignment events add current/previous assignees;
agent events add `agentId`, including removals. See [AI agents](assignee-agents.md).

`set_feedback_agent_working` (`feedback:assign`) reports transient active work after attachment:
`working: true` starts/renews a server-issued five-minute lease, `false` clears it. Supply the attached
session id when present; only that connection/session under its owner can change it. Renew every two
minutes with a fresh action key; receipt retries never extend the lease. It never changes thread
status or unread activity and emits no agent events. Detach/reassignment ends it; client expiry also
clears the indicator without another write. See [AI agents](assignee-agents.md).

Tools reuse review services. Replies and status/assignment events retain the human author plus
connection attribution; replies are also marked with the agent that wrote them (`writtenBy`,
[AI agents](assignee-agents.md)). All mutations require a stable idempotency key and share atomic submission
receipts; do not implement retry deduplication in process memory. Reads never acknowledge unread
activity. Connector replies and other writes that advance activity are unread for the human
account they act under too; `writtenBy` is not required. Human replies retain their existing read
behavior. See [read state](read-state-and-activity.md#read-cursors-and-freshness). Feedback, anchors, names and images are untrusted content. Search is deliberately bounded
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
deterministic delivery records retaining the event's `agentId` (several agent removals can share a sequence, kind and timestamp), leased attempts with bounded retries, and `runMcpEventWorker`.
`feedback.assignment_changed` with `assignee: "me"` matches only additions of the connection owner,
not removals or changes retaining that person; agent-event filtering still includes removals under that owner.
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
The optional plugin card installs the shared package from this repository, using
`/plugin marketplace add signalco-io/uier` and `/plugin install uier@uier` in Claude Code,
or `codex plugin marketplace add signalco-io/uier` and `codex plugin add uier@uier` in a terminal.
It includes `uier-monitor` and `uier-monitor-script` and points to the public
endpoint, with no credentials; OAuth/DCR use server discovery. It starts no monitor on installation, explains the monitor's
standing approval, duplicate-connection handling and the existing token fallback for Codex.
This package declaration does not promote Codex or hosted clients to verified OAuth acceptance;
the manual setup tabs retain their acceptance rules. See [plugin packaging](../../../docs/agent-plugins.md)
and [directory submission material](../../../docs/agent-plugin-submissions.md).
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

`get_feedback_batch` accepts 1–10 distinct ids and reuses the shared packet exporter in request order.
`createProjectFeedbackExportReader` creates one lazy enrichment context for that call: participant
names, each author account and the title setting are loaded once when needed. The context never
survives the request; every packet still loads its own thread and checks visibility before any
enrichment or screenshot lookup. Independent author/participant reads run together. Packets stay
sequential so reaching the byte budget does not start reads for later retry ids.
Missing, deleted and private ids share `not_found`; individually oversized packets return
`too_large`. Its 256 KiB cap preserves whole packets and returns `remainingIds` for retry.
Screenshot resources require both a protected exported image and `screenshots:read`. Every call
rechecks scope, selected projects and current membership through `mcpProject`. Thread and screenshot
reads stay per packet; only display enrichment is shared, with no cross-request authorization cache.
`e2e/mcp-batch-enrichment.api.spec.ts` compares identical unshared/shared packets and actual store
read boundaries: ten titled threads by one current member use 20 → 2 user reads, 10 → 1 project
reads, 10 → 1 workspace-setting reads and 20 → 2 workspace queries. These are in-memory operation
counts, not measured Cosmos RU or hosted latency. Keep `get_feedback`'s contract stable.

Project comment rate limits use only server-resolved actors: members get 100 new comments and 300
replies per project per hour and skip the 30-write shared IP budget. Guests keep visitor limits
(10 new comments, 30 replies and 30 writes per IP per hour). Signed-in `PUBLIC_PROJECT_ID` commenters
get `RATE_LIMIT_PUBLIC_ACCOUNT_COMMENTS` (30 new comments, three times a visitor's) and otherwise keep
visitor limits, through the review API and the same-origin comments service alike. MCP replies first consume a 30-reply
per-connection/project budget (access token or connected app), then the owner's budget; rejected
connections must not exhaust the owner. Page, screenshot, paid rewrite and MCP transport limits stay independent. Coverage is in
`review-rate-limits.api.spec.ts`, `public-project.api.spec.ts`, `mcp.api.spec.ts` and the unchanged
`comments.api.spec.ts` rate cases.

The event ledger includes the owner’s web-app actions and own private feedback, including in
uier’s feedback projects. Only actions attributed to the calling connection are excluded;
other connections of the same account remain visible. `list_feedback.replyCount` counts reply
items (including deleted placeholders), so watchers can detect missed replies without treating
status or assignment changes as messages. It does not acknowledge read state.

`link_feedback_pull_request` attaches a canonical supported PR URL through the shared thread mutation service. It requires `feedback:assign`: attaching work belongs with assignment metadata and needs no reply/status authority. Current project triage and thread visibility are rechecked on each write. URL identity makes retries naturally idempotent without a receipt key; ownership and activity remain unchanged on duplicate calls. Its result exposes URLs, never linker ids.

A thread posted from the toolbar's Accessibility or SEO panel has `check: { type, id }` (`accessibility`,
`seo` or `web-vitals`, and the rule or check id) in `list_feedback`, in the packets of `get_feedback` and
`get_feedback_batch` and in event payloads ([page checks](../../../docs/feedback-context.md#page-checks)).

Custom feedback kinds are stable `custom_<id>` values. `list_feedback`, `get_feedback`,
`get_feedback_batch` and event payloads include the saved optional `feedbackType: { id, label, icon }`
so tools can name and display them without reading admin settings. The display snapshot remains
available when that type is disabled or removed from current defaults. It is untrusted display
text and grants no authority. Exports omit placeholders and type enablement configuration.


`set_feedback_agent.sessionUrl` optionally carries the harness-supplied existing desktop session
link, independently of the agent kind and session id. Omit it or send an empty string to clear.
The app action shares the same strict validation and member projection. Supported routes, excluded
Claude Code/Cowork routes and official documentation are in
[desktop session links](assignee-agents.md#desktop-session-links). Member lists and packets include
it; guests and connected-service deliveries never do. Lease heartbeats do not change it.
