# Authenticated MCP connector

The public setup guide is `/guides/mcp`, distinct from the `/features/ai` overview. It renders
`mcpClientConfigurations` and `mcpPluginCommands` from `clients.ts`, also used by Account → Coding
agents; examples contain environment references only. Keep its authentication/qualification,
first-read, image permission, thread-card and revocation guidance with [docs/mcp.md](../../../docs/mcp.md)
and the plugin reference. `e2e/mcp-guide.spec.ts` checks configuration parity, internal links and
desktop/mobile accessibility. A public guide adds no client OAuth qualification or monitoring grant.

`/api/mcp` is stateless, on the official MCP SDK v2 (`@modelcontextprotocol/server`; tests use
`@modelcontextprotocol/client` and the schemas of `@modelcontextprotocol/core`), and serves
two protocol generations (see Protocol revisions and transport below). `src/lib/mcp/` owns
authentication, scopes and tools; `src/lib/mcp/oauth/` is uier's own OAuth 2.1 authorization server
for this endpoint only. The contract is [docs/mcp.md](../../../docs/mcp.md); the design record and its
decisions are [docs/mcp-oauth-plan.md](../../../docs/mcp-oauth-plan.md). Two kinds of connection resolve
to one `McpIdentity` in `credentials.ts` (user, `connection: { id, kind, name, clientId? }`, scopes,
`AgentAccess`, and optional explicitly selected account identities):

- **Connected apps (OAuth).** `uier_at.` access tokens backed by an `mcp-grant`, created through
  consent at `/app/connect/<requestId>` and listed under Account → Coding agents → Connected apps.
- **Access tokens.** `uier_mcp.` credentials for environments without a browser: 30-day,
  named, read-only by default, with explicit project selection in the current workspace; raw secrets
  are shown once and only hashes are stored. They become
  `{ kind: 'selected', workspaces: [{ workspaceId, projects }] }` internally.

Never accept cookies, review tokens, project codes or guest ids as MCP authentication.

**Grants are evaluated live.** A grant stores a selection (`AgentAccess`: `all`, or chosen workspaces
each with `'all'` or project ids) per explicitly approved account and shared scopes, never a permission
snapshot. `accounts` is authoritative when present; older grants fall back to the managing `userId`
and `access`. `mcpProject` resolves the project's workspace (`grantedWorkspaceOf`, else `findProject`),
checks each account's `accessCovers`, then `memberActor` for current membership, team grants and the
staff allowlist. The managing profile takes precedence when selected, followed by consent order;
exactly one actor supplies permissions, private visibility, attribution and the meaning of `me`.
These checks happen on every tool call and
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
- Consent (`actions.ts`, `authorize.ts`): approval compares the active session with the user id shown on the
  consent page before issuing a code, then revalidates every selected profile with
  `browserSessions(cookies())`. Only this explicit consent uses parked session credentials; normal
  app requests still authorize the active account alone. Up to five distinct accounts can be selected,
  each with its own `validateAccessChoice` workspace/project check. Only the active account starts
  checked. Account selections never change browser cookies, and accounts added later are never
  implicitly included. The active account manages the grant and its token partition even if not
  selected for project access. Approval enforces 20 active connected apps per managing user unless replacing one,
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
redirects after a form post). The page always renders `ConnectConsent`, which keeps the outcome if a
server-action refresh follows consumption of the request. The connect layout mounts the account
boundary and reloads the consent URL on an account change; stale approval actions are refused
server-side even before that reload. `account-consent.api.spec.ts` covers stale approvals. Both share
`ClientDetails` (Unverified, Published at, Sends you back to) and `scopes.ts` labels.

The consent page lists all verified signed-in profiles with their own access controls. Use another
account adds a sign-in and returns to the pending request. One approval and token refresh chain retain
all selected profiles independently of later browser account/workspace switching or sign-out.
Connected apps remain managed under the active account at approval; Revoke ends the shared grant
for all profiles. `connectedAppView` receives only profile presentations validated through current
browser sessions, so secondary email/workspace/project names are hidden once that profile is signed
out. Changing included accounts requires reconnecting and replacing the connection.
`list_projects` returns each project's acting `account: { id, name, email }` and workspace, deduplicates
shared projects in the same actor order, and accepts continuation offsets beyond a single account's
1000-project scan window. Each returned multi-account page resolves its acting profiles with
`mcpProject`, so a discovery scan cap cannot change the profile used for a shared project.
Project tools report that profile in `actingAs`; `me`, agent attachments,
replies and unread state use it. Event subscriptions retain the managing `userId` for grant lookup
and a separate `actorUserId` for filters. Delivery rechecks the same actor and subscription start
time; changed actors require a new subscription and queued events from the old profile are skipped.
A push stream is opened as one profile too: when the project's acting profile changes, it ends with `terminated`.

**Protocol revisions and transport.** `http.ts` builds one server per request (`createFeedbackMcpServer`) and routes it by the SDK's own
classification (`classifyInboundRequest`): a body with the per-request `_meta` envelope is
`2026-07-28` and goes to the SDK entry (`createMcpHandler` with `legacy: 'reject'`, whose factory hands
back the server prepared for that `Request`); anything else is a 2025-era request and gets
`WebStandardStreamableHTTPServerTransport` in stateless JSON mode, as before. Keep one definition for
both: never register a tool for one generation only. The SDK entry answers `server/discover`, checks
the standard headers and stamps `resultType`; `initialize` is the 2025 path. Don't replace the
hand-wired 2025 path with the entry's default fallback: it answers every request as an SSE stream.

- Capabilities end with `listChanged: false` for tools, prompts and resources (set after the
  registrations, which turn it on). With that, the SDK acknowledges `subscriptions/listen` empty and
  closes it; a `true` would hold a stream open for notifications that can never be sent.
- `cacheHints` let a `2026-07-28` client keep `server/discover` and the lists for five minutes
  (`private`). They depend only on the connection's operations.
- Errors are `ProtocolError` with `ProtocolErrorCode` (the wire message has no `MCP error <code>:`
  prefix any more). A tool that does not exist is a JSON-RPC `-32602`, not a tool result.
- The SDK checks `Mcp-Name` for its own methods only. `eventNameHeaderRejection` (`events/protocol.ts`)
  does it for the event methods, before the entry is called, because the answer must be an HTTP 400.
- `serverCard.ts` is discovery without a connection: the Server Card at `/api/mcp/server-card` (the
  extension's reserved location) and the AI Catalog that `next.config.ts` rewrites from
  `/.well-known/ai-catalog.json`. Public and unauthenticated: never put anything there that is not
  already public. It also names the server (`mcpServerInfo`) and publishes the webhook signing key.
- `skills.ts` serves the plugin's skills (`plugins/uier/skills`) through the SDK's Skills extension
  (`skills/list`, `skills/get`, `skill://` resources). The files are read at run time from the
  repository layout, so `next.config.ts` traces them into the deployment (`outputFileTracingIncludes`);
  when they are missing the endpoint works without skills. Edit the skills in the plugin, never a copy.
- Step-up authorization: a handler that finds an operation missing throws `McpScopeError` as before
  (the check stays its first step, so a refused call changed nothing). `handleMcp` then turns the
  answer into a `403` scope challenge (`scopeChallenge`, `oauth/metadata.ts`) when the connection is
  OAuth and the request names revision `2025-11-25` or later; everyone else keeps the tool error.
  The consent page starts from the same client's connection (`current`), and `exchangeCode` keeps
  that grant's id when the same client replaces it, so receipts, agents and subscriptions stay.
  Never challenge before the handler has refused: which operation a call needs is decided there only.
- The only response that stays open is `events/stream`. For it the 2025 transport is created without
  JSON mode, and `handleMcp` closes the server and writes the request log when the body has been sent
  (`whenSent`), not when the response object is returned.

The route has `maxDuration = 300` for push streams; `handleMcp` races the answer against a 25-second
deadline (overridable by API specs) and the request abort signal, returns a JSON-RPC error on
interruption and always closes the server; a stream that has opened ends itself after four minutes. Screenshot resources map `ApiError` to `InvalidParams` with its
code/message, zod errors to fixed `InvalidParams` text and unexpected errors to `InternalError`
with `The operation failed.`; the request log records the failure. Never return raw storage diagnostics.

**Request logs.** `handleMcp` emits one `mcp_request` event per request through `mcp/telemetry.ts`
([request logs](../../../docs/mcp.md#request-logs)). `createFeedbackMcpServer` calls `log.watch(server)`
before registering anything, so every tool, prompt and resource is logged by name and its own schema,
and the answers are seen on whichever transport the server is connected to (`watch` wraps `connect`);
a request the SDK entry refuses before any handler is logged by its JSON-RPC code (`log.refused`);
handler catch blocks call `noteMcpError(error)` before mapping the error. Events carry names, codes,
counts, sizes and keyed connection/account references. The two bounded monitor read tools also
record numeric database RU and SDK operation counts, including the HTTP quota counter; the same
RU is returned in `x-uier-database-ru`. Request-local accumulation runs independently of sampled
diagnostic logs. Other tools, streams and interrupted requests omit this billing header. This
excludes TTL cleanup, storage, transfer and hosting, and stores no additional identifiers. Argument values are kept only for booleans,
`null`, numeric fields and options the schema declares; never log content, ids, names, tokens, URLs or
error messages, and never let logging change or fail a response. `e2e/mcpTelemetry.api.spec.ts` covers
it; the other MCP specs pass `{ emit: quiet }` to `handleMcp`. The privacy policy's "Coding tool access"
describes these records: change it with what they contain. The event contract,
`mcpRequestEventSchema`, lives in `mcp/telemetrySchema.ts` (zod and scope names only) so
`scripts/mcp-report.mjs` and `mcp/report.ts` can validate exported events without loading the server;
`e2e/mcp-report.api.spec.ts` covers the [daily report](../../../docs/mcp.md#daily-report).
Access tokens remain bound to one workspace and one acting profile; connected apps reach the
accounts and workspaces chosen at consent. A token created through a multi-account connection keeps
the chosen project's acting profile while its managing account retains the creation receipt, guard
and revocation controls. Token refresh preserves account choices and narrowed scopes.

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
and labels the token "Created by <connection>". A token acting under a different selected profile also
shows "Acts as <account>"; its email and project names come only from that profile's currently verified
browser session, otherwise the account is "Another account" and projects use their ids. This never
adds projects to the current workspace's manual token form. Request telemetry records tool outcome and shapes,
never the secret or name. `e2e/mcpAccessTokens.api.spec.ts` covers validation, authorization, live
access, limits, atomicity, retries and secret-free audit/logs; OAuth API coverage includes narrowed
scopes and refresh. The OAuth browser journey proves opt-in, account provenance and revocation.
Account guidance and `mcp/workflows.ts` explain where feedback about uier itself lives (the uier
workspace's public-feedback project). Missing project grants stay `not_found` without exposing
project existence; direct users to `list_projects` and to reconnecting or explicit token setup
rather than expanding access. List-tool descriptions and field schemas must both
state the default summary 1–25 limit and `nextCursor` pagination, since clients may flatten schema constraints.
`list_feedback` also names its explicit compact `state` view and that view’s 1–1000 limit.

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
activity. Connector replies are unread for the human account they act under too, even without `writtenBy`.
MCP status and
person-assignment changes are own activity for that account and do not acknowledge earlier unread
activity. Other members still see those changes as unread. Human replies retain their existing read
behavior. See [read state](read-state-and-activity.md#read-cursors-and-freshness). Feedback, anchors, names and images are untrusted content. Search is deliberately bounded
to the latest 1000 threads; summary pages contain at most 25 rows. The explicit compact
`state` view can return up to 1000 state rows within the same window and response byte limit. The optional `monitorScope` filter selects the acting member’s own threads that are unassigned or assigned to them.
The `assigned` scope also includes other authors’ threads assigned to that member. It composes with visibility, status and paging.
Keep the documented context
contract shared with developer issue export: `projectFeedbackExport` in `review/feedbackContext.ts`
produces the same `@uier/toolbar/feedback-context` packet. Screenshot resource reads must honor
its deleted-evidence filtering too. `e2e/mcp.api.spec.ts` exercises the official HTTP client
and service isolation; `e2e/mcp.spec.ts` covers user credential setup, client access, revocation and
light/dark accessibility; `e2e/mcpOauth.spec.ts` runs the SDK client's OAuth flow (dynamic
registration, loopback listener) through sign-in, consent, approval, `list_projects`, a reply and
revocation in Account (`@smoke`), plus cancel, request reuse, another account and the error page.
This connector does not prove #90 launch acceptance.

**Events (webhooks, streams and polling).** `src/lib/mcp/events/` implements SEP-3415 (MCP Events, a
draft) with all three delivery modes ([docs/mcp.md](../../../docs/mcp.md#events-webhooks-streams-and-polling)):

- `protocol.ts` registers the `io.modelcontextprotocol/events` extension capability (plus the design
  sketch's top-level `events`, which ChatGPT reads) and `events/list|poll|stream|subscribe|unsubscribe`,
  adds `resultType: "complete"` to every result (the SDK does on `2026-07-28`; 2025-era answers get it
  here) and holds the `Mcp-Name` check. `subscriptions.ts` owns the error code table (the SEP's
  provisional -32023…-32027).
- `feed.ts` is the stateless feed behind `events/poll`, the `list_feedback_events` tool and push
  streams: an opaque client-held cursor (watermark a minute behind, the start time, and short ids
  already returned since the watermark, so late commits arrive once; nothing stored per client). With
  `positions` it also returns the position after each event. Webhooks issue cursors in the same format
  (`watermarkCursor`), so one cursor resumes in any mode: keep it that way.
- `stream.ts` is push delivery: it polls the feed every three seconds, sends `active`, each event with
  its position, a heartbeat every 25 seconds, `error` for a failed read (once per outage) and `terminated` when
  `currentEventAccess` says access ended, and ends itself after four minutes with the empty result.
  One `mcp-event-stream` record per open stream (its connection's partition, 90-second TTL, renewed)
  enforces 12 per connection. Streams of a project on one instance share their reads. Nothing may be
  thrown after `active`; whatever refuses a subscription happens before it.
- `catalog.ts` has the event names, argument/payload schemas (additive only) and the mapping from a
  thread's `notificationEvents`.
- `subscriptions.ts`: deterministic subscription ids, TTL grants (clamped, never refused), limits,
  endpoint verification (the origin's `/.well-known/mcp-webhook-receiver.json` when it covers the path,
  otherwise the challenge), encrypted `whsec_` secrets, and where a new subscription starts
  (`startPosition`: now, or its cursor within the replay limits). A refresh ends a suspension. `currentEventAccess` is the one access recheck for
  deliveries, sweeps and streams: only a definite answer (no connection, or a 403/404 from
  `mcpProject`) ends anything, never a storage error.
- `watermark.ts`: a webhook subscription's position (the safe-to-persist watermark), computed from the
  project's discovery cursor and the subscription's deliveries that still wait; never stored. It also
  holds the cursor and delivery record types.
- `identity.ts`: the server's ed25519 signature (`v1a,`) on every webhook request, with a key derived
  from the server secret (the app and the worker both have it; nothing is stored). Its public key goes
  on the Server Card only: a key taken from a request would prove nothing.
- `webhook.ts`: Standard Webhooks signing and the POST, which goes only to public HTTPS on the default
  port through `publicNetwork.ts` (the same connection-time address check as OAuth metadata fetches),
  never follows redirects and reports fixed failure categories only.
- `delivery.ts`: discovery from `listChangedSince` with a per-project cursor, deterministic delivery
  records retaining the event's `agentId` (several agent removals can share a sequence, kind and
  timestamp), leased attempts with bounded retries, and `runMcpEventWorker`. Each delivery record has a
  random `webhookId`, reused by its retries; the SEP forbids deriving it from `eventId`. A subscription
  with `replay` gets its own scan (`replaySubscription`) for the events before it existed: never rewind
  the project cursor for it, other subscriptions' expired records would be created again. An event
  given up (retries exhausted, 413, too large; not 410) marks the subscription `gap`: the endpoint gets
  a `gap` envelope after its next acknowledged delivery, or the next refresh says `truncated`. An
  endpoint that only failed for an hour (ten attempts or more) suspends its subscription: deliveries
  wait without using attempts until a refresh, which answers `active: false` once. Ending
  a subscription for lost access sends one signed `terminated` envelope.

`feedback.assignment_changed` with `assignee: "me"` matches only additions of the connection owner,
not removals or changes retaining that person; agent-event filtering still includes removals under that owner.
Events never get their own write path: add an event kind to `notificationEvents` and map it in the
catalog. Every attempt rechecks the connection (`currentMcpConnection`), `mcpProject` and
`canSeeComment`, and the scheduled sweep (`recheckAccess`) rechecks every live subscription; lost access
deletes the subscription. Never deliver a connection's own changes
back to it, never log callback URLs, secrets, arguments or payloads, and keep payloads minimal and
marked untrusted. `review/comments.ts` calls `queueMcpEventDelivery` after `createProjectComment`,
replies and `changeComment`; it runs only when `instrumentation.ts` registered `after()`, so API
specs call `dispatchProjectEvents` themselves. The scheduled worker sweeps after integrations.
`UIER_MCP_EVENTS_TEST_HTTP_CALLBACKS=1` admits `http://localhost` callbacks in local runtime only (the
Playwright server sets it); never set it on a deployment. `e2e/mcpEvents.api.spec.ts` covers the
contract with `e2e/support/webhookReceiver.ts` and `e2e/support/eventStream.ts` (it passes short
stream timing through `handleMcp`'s `stream` option, and writes `2026-07-28` requests by hand, because
the SDK client does not send `Mcp-Name` for event methods); `e2e/mcpEvents.spec.ts` proves webhook
delivery and an open stream over real HTTP.

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

**Read-only thread card.** `show_feedback` uses the same authorized handler and packet as
`get_feedback`; only the display tool has `_meta.ui.resourceUri` pointing at
`ui://uier/thread-v1.html`. Keep the normal text/structured result usable without MCP Apps.
The `text/html;profile=mcp-app` resource is a bundled static shell, with no embedded feedback,
credentials, external scripts or images. Its CSP declares no external connection/resource
domains. The host supplies data through the MCP Apps bridge, and refreshes call `get_feedback`
through that same authenticated host every 30 seconds while visible, or on **Refresh**.
Do not add an alternate browser API, cookie authentication or tokens to the card. Each read must
retain the ordinary live scope, project and visibility checks. A read the host doesn't answer in
time keeps the last result with a warning, and the 30-second checks continue. A tool error, invalid
packet or JSON-RPC error removes the displayed content: an RPC error can't tell refused access from a
client that lost its server, so the card clears for both and its copy names both. A failed
`ui/initialize` or a `ui/resource-teardown` ends the card: Refresh is disabled and the card asks
for the thread again. Refresh is otherwise disabled only while nothing has loaded; a running read
ignores more clicks, so focus stays on it through each check. Only the notice line and status
changes are live regions; the last-checked time stays out of them, so a check that changes nothing
announces nothing. An up-to-date card draws one footer line, the last-checked time: its notice
("Updates every 30 seconds") stays in the live region for screen readers and as the time's tooltip.
Warnings are drawn above the time. The status dot follows BRAND.md (Open an ink ring). The card
reuses the app's message pieces, so it can't drift from the thread: the latest message is laid out like
`Message` (`MessageAvatar`, the name, "via" and the agent's mark) and its text is `MessageMarkdown`; the
assignees are `AssigneeAvatars`. `scripts/build-mcp-app.mjs` bundles the `@uier/toolbar/*` modules they import
from source (each export's `types` entry), since `pnpm dev` builds the card before the toolbar's watch build
has written anything. List any component the card starts using with `@source` in `thread.css`: the
preset's `content` glob also scans all of `apps/web/src` today, so a missing entry won't show until that
changes. Screen readers hear the assignees as the app's `assignedLabel` (agents included). Avatars are initials: profile pictures need a session cookie and are
same-origin only, and the card loads no images. Agent kinds the card doesn't know get the generic mark. A message
longer than five lines shows them, the last one faded, with **Show more** (`aria-expanded`); focus moving to
a link in or under the fade shows the rest, and a check that finds the same message keeps it open. Message links are
http(s) or mailto, as the parser allows, and open through `ui/open-link`, never by navigating the
sandboxed frame; a refused one says so in the footer. The card
draws its own edge (a 1 px border and 12 px radius on the card surface, the latest message on the
muted surface) over a transparent page, so the resource declares `_meta.ui.prefersBorder: false`:
a host that also framed it would double the border. No writes, screenshots,
event subscriptions or read-cursor updates belong to this card. The tool is for a requested
thread display, not for every monitor poll. Tests: `e2e/mcpApp.spec.ts` (a host in a page, the
built card in its iframe). See [the client contract](../../../docs/mcp.md#thread-cards).

`list_feedback` shares path, source, assignment and activity projection with the app through
`app/projectCommentRouting.ts`. Canonicalize its optional path with `pagePath`; pass path and
`environmentFilter` into `listProjectComments` before the 1000-thread storage limit. Validate
environment ids against `environmentOptions` plus `unknown`/`removed`; never use the toolbar's
fallback selection for MCP input. Other filters apply only within that window. Read the connection
owner's cursor after filtering visibility; never acknowledge it. Deleted first messages omit
author kind and screenshot presence, and author ids never enter summaries.

`list_feedback` filters raw authorized comments before paging, then prepares display details only
for the returned summary page. It loads participant names only when a returned row has assignment
or verification details, skips cursor enrichment for an empty page, and uses the already loaded live
workspace for the AI-title setting. Unread filtering still loads the complete matching cursor set
before pagination; no access decision, comments or display metadata survives a request.

The optional `view: 'state'` is for occasional watcher reconciliation, between event-cursor polls.
It accepts `limit` 1–1000 (default 20); the default `view: 'summary'` keeps the 1–25 limit. Both use
the same live scope/project/member/private checks, filters and newest-1000 storage window. State rows
include only `id`, `number`, `updatedAt`, `resolved`, `stage`, `priority`, `private`, the first
`assignee: { id }` or `null`, `authorKind` when its first message is present, and `replyCount`.
They omit content, display names, title/label/workflow definitions, verification details and unread
status. The unread filter is still honored when requested. State requests skip participant and
read-cursor enrichment unless that filter needs cursors. Whole state rows stop before the 256 KiB
result limit; always continue `nextCursor`, even when fewer than the requested rows return. The
cursor remains an offset in the current filtered window, not a snapshot or a wider history scan.
`e2e/mcp.api.spec.ts` covers compact/summary state parity, paging after the byte limit, live access,
and a 201-thread fixture’s list/read boundaries and result bytes.

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
Single/batch packets also expose `replyScreenshotResources: [{ itemId, uri, access }]` for protected
reply images when the same scope is granted. Their resource template is
`uier://projects/{projectId}/feedback/{commentId}/replies/{itemId}/screenshot`. Each read rechecks the
reply's live, non-deleted exported image before loading its bytes through `getProjectScreenshot`.
Missing or deleted reply images are absent from exports and cannot be read through guessed URIs.
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

For a saved change proposal, the `list_feedback` summary has `hasProposal: true`. `get_feedback`,
`get_feedback_batch` and `show_feedback` return the original and proposed values in `context.proposal`
and in the issue Markdown, through the usual thread visibility check. The values are untrusted evidence
and are removed with the first message. The compact `state` view keeps its monitoring fields.

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

Archive is additive: `list_feedback.archive` is `exclude` by default, `only` for the archive, or `all`.
This scope is applied before the storage window, alongside page/environment. Summaries, state rows and v1 context packets expose optional `archivedAt`. The existing
`resolved`, `status` and `stage` keep their meanings. `workflowStatus` describes the retained
workflow status. A saved archive destination is available independently as `archiveStatusId`.
`set_feedback_archived` requires `feedback:status`, accepts `archived: boolean` and the usual write ids
and receipt key, and preserves workflow/content/verification. Authorized single/batch reads and
screenshots remain available. `feedback.archive_changed` uses the durable notification ledger and
existing webhook/push/poll privacy and connection filtering, without owner email. Old status tools do
not restore archived feedback. `mcp.api.spec.ts` covers scopes, defaults, restore and receipt replay.

Account setup and consent copy use the [app language](localization.md), including scope descriptions and access summaries. Client names, endpoint/configuration values, prompt ids and the exported SKILL.md keep their protocol and workflow values. Pure access-summary formatters accept the request’s optional locale without changing default English protocol callers.

Non-reply writes through either OAuth or access tokens count as the acting account’s own activity.
They do not mark that account’s thread unread or acknowledge earlier unseen replies. Agent replies
still mark the owner’s thread unread, including replies without a `writtenBy` claim. Real account
authorship and connection attribution on notification events remain unchanged; email self-recipient
exclusions still apply. See [read state](read-state-and-activity.md#read-cursors-and-freshness).

### Custom status discovery

`list_feedback_statuses` requires `feedback:read` and the same live `mcpProject` access check as
thread reads. It returns the effective workspace/project workflow, ordered definitions (ID,
category, label, description), and initial/Done/Archive defaults. Archive entries are legacy destinations. Results are untrusted content.
`list_feedback` adds `workflowStatus`; member single/batch packets add the same display object.
Guest exports omit this enrichment. Existing category filters and legacy write inputs retain their
meaning. The generated connector skill lists the discovery tool and treats descriptions as untrusted guidance.

`set_feedback_status` accepts exactly one of `statusId`, legacy `status`, or `resolved`. Use `list_feedback_statuses` for IDs. `request_feedback_verification` and `cancel_feedback_verification` also accept `statusId` within their permitted categories. Same-category moves emit `feedback.status_changed` with `change: workflow_status_changed`, previous/selected IDs, label and category. These names remain untrusted content. Same-category events are not emailed.

`set_feedback_status` results include `archivedAt` (or `null`). Legacy archive destination IDs
are still accepted. Archiving and restoring emit `feedback.archive_changed`. Changing an
archived thread’s destination leaves its workflow status and status events alone.

Fix verification is a per-project opt-in, off when absent. `list_feedback_statuses` reports `verificationEnabled` and omits Ready definitions when off; lists and packets project dormant requests as Open/In progress. `request_feedback_verification` refuses with “Fix verification is off for this project. Mark the comment done instead.” Custom Ready IDs are refused too. Ordinary approved `set_feedback_status` Done remains available and does not record reviewer confirmation. Existing request revisions/evidence are retained, and requests resume on re-enable unless closed in the meantime.

### Thread labels

`list_feedback_labels` (`feedback:read`) returns the project's effective workspace/project catalog
including IDs, names, descriptions, brand palette colors and optional icons. `list_feedback`
accepts optional `labelId`; it combines with the other filters within the documented authorized
1,000-thread window. Summaries and single/batch packets add `labels` with the currently assigned
definitions. Packet enrichment reuses the request's one workspace read. All label content is untrusted.

`set_feedback_labels` (`feedback:assign`) accepts `projectId`, `commentId`, `labelIds` (1–20 distinct
IDs), `mode: 'add' | 'remove'`, and the usual `idempotencyKey`. It shares the app's member triage,
private visibility and current catalog checks; it cannot create definitions or change project settings.
Atomic add/remove preserves concurrent unrelated labels. Receipt keys are connection-scoped and
replay without reapplying an old operation. Results include acting identity, comment ID and labels.
This creates ordinary thread activity/history without email or a dedicated label event.
`thread-labels.api.spec.ts` and the labels case in `mcp.api.spec.ts` cover this contract.

## File proof handoff

`proofs:read` is explicit consent. `list_proof_files` lists the live published files
available to the selected account. `list_proof_threads` uses the proof predicate and
visibility before paging. For a direct read, a batch or an MCP Apps card, pass the
owning `assetId` with the existing project and thread IDs. The packet links to the original
location and, when requested and present, a saved location on the selected revision.
The machine projection contains saved discussion and an anchor category. Media URLs,
source manifests, anchor excerpts, guest identity and named decisions stay out of it.

Replies, ordinary status and assignment reuse the existing scoped operations and
idempotency receipts. The file actor refreshes the bearer, selected account, project,
asset and publication on each conditional write and receipt retry. MCP does not confirm
verification or approve a version. Website tools and event feeds keep their existing
predicate. A file-only credential cannot read website threads or use website writes.
`create_access_token` accepts up to 20 `proofAssetIds` for one project; discovery, reads
and uploads all enforce that subset.

## File proof uploads

`proofs:upload` is an explicit write scope in Coding agents and connected
app consent. A scoped agent can use `list_proof_files`, `begin_proof_upload`,
and `finalize_proof_upload` on projects it currently reaches. The begin tool
returns a temporary create-only PUT URL. Its result contains storage
credentials, so clients must keep it out of logs and messages. Finalize
returns an ordinary immutable viewer URL and rechecks the original agent
grant. Figma imports use the member's Figma authorization in the Files UI.
