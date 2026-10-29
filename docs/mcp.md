# Coding tool access (MCP)

Connect a coding tool to the feedback you choose. The endpoint is `https://uier.io/api/mcp` (use your
local or preview origin while testing). It uses the
[official TypeScript SDK's Streamable HTTP transport](https://ts.sdk.modelcontextprotocol.io/server)
with stateless JSON responses. For the shared feedback packet, see [Feedback context](feedback-context.md).

A coding tool connects in one of two ways:

- **Sign in from the tool (OAuth).** The tool opens uier in your browser, you choose what it may reach
  and do, and the tool receives tokens that it renews on its own. Nothing is copied into a file or an
  environment variable. Claude Code is the client offered with this today.
- **An access token from Account.** For environments where no browser can complete sign-in, such as
  SSH sessions, containers and CI, and for clients not yet offered with OAuth. See
  [Access tokens](#access-tokens).

Either way, the connection acts as your account and never exceeds what you can currently do in the app.
Removal from a workspace, a lost team grant or a private thread applies on the next request. Public
project codes, guest ids, review links and app cookies cannot authorize MCP.

The design record, the decisions behind it and where the code differs from the plan are in the
[MCP OAuth plan](mcp-oauth-plan.md).

## Connect Claude Code

```bash
claude mcp add --transport http uier https://uier.io/api/mcp
```

Then run `/mcp` in Claude Code, choose **uier** and **Authenticate**. Your browser opens uier: sign in
if needed, choose access and operations, and select **Allow access**. Claude Code stores the tokens and
refreshes them itself. The entry applies to the current project; add `--scope user` to use it in every
project. See [Claude Code's MCP documentation](https://code.claude.com/docs/en/mcp).

Remove any `Authorization` header from an existing uier entry first, for example the earlier
`.mcp.json` setup with `UIER_MCP_TOKEN`. Claude Code does not try OAuth while a header is configured:
delete the `headers` key, or remove the server with `claude mcp remove uier` and add it again.

## Other clients

Claude (web, desktop and mobile), Codex, Cursor and VS Code are not offered with OAuth yet. Each one is
offered after its sign-in passes a live check against a deployed endpoint: discovery, consent, the
return to the client, a refresh after an hour, and revocation. Until then, use an
[access token](#access-tokens) where the client supports request headers. uier does not block other
clients from signing in; they are only missing from Account because their sign-in has not been checked.

- **Claude custom connectors** connect from Anthropic's servers, so they cannot reach a local endpoint.
  Their sign-in returns through `https://claude.ai/api/mcp/auth_callback`.
- **VS Code** documents HTTP headers and masked `promptString` inputs (`password: true`, `${input:...}`)
  in its [configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).
  No ready block is offered because a client connection has not been verified.
- **Windsurf** has [current documentation](https://docs.devin.ai/desktop/cascade/mcp) that describes
  legacy Cascade in Devin Desktop, with `serverUrl` and `${env:UIER_MCP_TOKEN}` header interpolation. It is not
  offered without a verified connection.

Do not use a third-party bridge.

## What consent asks

The tool's authorization request lands on `/app/connect/<requestId>`, after sign-in if you were signed
out. Only that random request id passes through sign-in. The page shows:

- **The tool.** Its name as the tool supplied it, where its description is published (the host of its
  metadata document) or **Unverified** when the tool registered itself, and where it sends you back: a
  host, or this computer for a loopback address. A name is never verified identity. Only continue if you
  just started sign-in from a coding tool.
- **Access.** "All my workspaces and projects, including new ones" (the default), or "Choose workspaces
  and projects", where each workspace gets all its projects, including new ones, or the projects you
  pick. Only workspaces and projects you can access are listed.
- **Operations.** Read feedback (always included), Read screenshots, Reply to feedback, Change status and
  Assign feedback. The operations the tool asked for are preselected; Claude Code asks for Read feedback.
  **Select all operations** picks all five. Operations apply to the whole connection, not per workspace.
- **Connection name.** Prefilled from the tool's name, 1–60 characters. Replies, status changes and
  assignments made through the connection show this name.
- **Replace.** When you already have a connection from the same tool or with the same name, you can
  replace it instead of adding another.

**Use another account** signs you out and returns to the same request after sign-in. Write operations
combined with several workspaces, all of them, or projects where guests can comment add a warning.

**Allow access** returns the browser to the tool with a single-use code: the page shows "Returning to
<tool>. You can close this tab." with a link, and navigates there itself. **Cancel** returns
`access_denied`. An unknown, expired or used request asks you to start again from the tool. Consent is
shown every time, also when the same tool reconnects.

"All my workspaces and projects" also reaches workspaces you join later, for example as an external
reviewer of a client, and the shared uier workspace that every account joins, where anyone can leave
feedback. Feedback is untrusted content in every case: approve each reply, status change and assignment
in your coding tool.

## Connected apps

**Account → Coding agents → Connected apps** lists your OAuth connections: the name, the tool, its access
and operations. Connections belong to your account, so every workspace shows the same list. You can have
up to 20 active connected apps, separate from your access tokens; at the limit, replace or revoke one
before connecting another.

**Revoke** ends a connection on the next request, also for a client that is connected right now: every
access token is checked against its connection on each request. A tool can end its own connection
through the [revocation endpoint](#endpoints) with its refresh token; revoking an access token ends only
that token. Revocation cannot retract data the client already received.

You cannot edit a connection's access yet. To change it, connect again from the tool and replace the
existing connection.

## Access tokens

Use an access token where no browser can complete sign-in, or with a client that is not offered with
OAuth yet. In **Account → Coding agents → Access tokens**, give the token a name, select up to 20
projects in the current workspace, and choose operations. Read feedback is selected initially;
screenshots, replies, status changes and assignments each need an explicit choice. The app issues a
30-day token, shows the secret once, and lets its owner revoke it from any workspace. You can have up to
20 at a time. Only a SHA-256 hash and the grant metadata are stored. A token is bound to the workspace
in which it was created, and its selected projects never expand when new projects are created.

Send it as `Authorization: Bearer <token>`. Keep it out of every file and URL: set `UIER_MCP_TOKEN` in
the environment of the process that starts the client, then restart it. Merge the entry into the
existing client file. Account offers these blocks, built from the same endpoint:

**Codex** — `~/.codex/config.toml`. [Official bearer configuration](https://learn.chatgpt.com/docs/extend/mcp#streamable-http-servers):

```toml
[mcp_servers.uier]
url = "https://uier.io/api/mcp"
bearer_token_env_var = "UIER_MCP_TOKEN"
```

**Claude Code without a browser** — `.mcp.json`. [Official HTTP setup and variable expansion](https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcpjson):

```json
{
  "mcpServers": {
    "uier": {
      "type": "http",
      "url": "https://uier.io/api/mcp",
      "headers": { "Authorization": "Bearer ${UIER_MCP_TOKEN}" }
    }
  }
}
```

Keep the reference literal. Do not use a shell-expanded bearer header with `claude mcp add`: it saves
the expanded secret in settings. Approve the project server when Claude Code asks. This header turns
Claude Code's OAuth off for the entry; use one or the other.

**Cursor** — `.cursor/mcp.json`. [Official config interpolation](https://cursor.com/docs/mcp#config-interpolation):

```json
{
  "mcpServers": {
    "uier": {
      "url": "https://uier.io/api/mcp",
      "headers": { "Authorization": "Bearer ${env:UIER_MCP_TOKEN}" }
    }
  }
}
```

## The owning project

Use the owning `projectId` in the copied feedback packet, not an id found in the reviewed page URL.
Feedback about uier itself belongs to **uier.io public feedback** (`uier00000001`) in the **uier**
workspace, including feedback left while viewing another project's page. An OAuth connection reaches it
with "All my workspaces and projects", or when the uier workspace is among the chosen ones. An access
token reaches it only when it was created in the uier workspace with that project selected (and the
operations you intend to use, including Change status to close feedback). `list_projects` shows what a
connection can reach. An absent project or a `not_found` response does not prove that feedback was
deleted.

## Endpoints

| Endpoint | Method | What |
| --- | --- | --- |
| `/api/mcp` | `POST` | The MCP endpoint. `GET` and `DELETE` return 405 after authentication |
| `/.well-known/oauth-protected-resource/api/mcp` | `GET` | Protected resource metadata ([RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728)) |
| `/.well-known/oauth-authorization-server` | `GET` | Authorization server metadata ([RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414)) |
| `/api/oauth/authorize` | `GET` | Validates an authorization request and sends the browser to consent |
| `/api/oauth/token` | `POST` | Code exchange and refresh |
| `/api/oauth/register` | `POST` | Dynamic client registration ([RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591)) |
| `/api/oauth/revoke` | `POST` | Token revocation ([RFC 7009](https://datatracker.ietf.org/doc/html/rfc7009)) |

uier is its own authorization server, for this endpoint only. The issuer is the app origin
(`https://uier.io` in production, the preview or local origin elsewhere), so the issuer, the endpoints
and the protected resource share one host. There is no OpenID Connect: no ID tokens, no `userinfo`, no
`/.well-known/openid-configuration`. Only the path-specific protected resource document exists; there
is no root `/.well-known/oauth-protected-resource`.

### Discovery

`/api/mcp` answers a missing or unusable token with 401 and:

```text
WWW-Authenticate: Bearer realm="uier MCP", resource_metadata="https://uier.io/.well-known/oauth-protected-resource/api/mcp", scope="feedback:read"
```

When a token was presented, the challenge adds `error="invalid_token"`: an unknown, expired or revoked
access token, a token issued for another resource, a refresh token or a code. The body is
`{ "error": "sign_in_required", "message": "Sign in again from your coding tool, or use an unexpired access token from Account." }`.
A request with another `Origin` gets 403 before authentication.

`next.config.ts` rewrites the two `/.well-known/` paths to `/api/oauth/metadata/protected-resource` and
`/api/oauth/metadata/authorization-server`. Both answer JSON with `Access-Control-Allow-Origin: *` and
`Cache-Control: public, max-age=300`. The protected resource document:

```json
{
  "resource": "https://uier.io/api/mcp",
  "authorization_servers": ["https://uier.io"],
  "scopes_supported": ["feedback:read", "screenshots:read", "feedback:reply", "feedback:status", "feedback:assign"],
  "bearer_methods_supported": ["header"],
  "resource_name": "uier"
}
```

The authorization server document:

```json
{
  "issuer": "https://uier.io",
  "authorization_endpoint": "https://uier.io/api/oauth/authorize",
  "token_endpoint": "https://uier.io/api/oauth/token",
  "registration_endpoint": "https://uier.io/api/oauth/register",
  "revocation_endpoint": "https://uier.io/api/oauth/revoke",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "revocation_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["feedback:read", "screenshots:read", "feedback:reply", "feedback:status", "feedback:assign"],
  "client_id_metadata_document_supported": true,
  "authorization_response_iss_parameter_supported": true
}
```

`offline_access` is not listed. Every connection gets a refresh token; a requested `offline_access` is
accepted and ignored.

### Clients and redirect URIs

All clients are public: no client secret, `token_endpoint_auth_method` `none`, grants
`authorization_code` and `refresh_token`, response type `code`.

- **Client ID Metadata Documents (preferred).** A `client_id` that is an `https:` URL with a path, no
  query, fragment or user information, a DNS host name and the default port is fetched when sign-in
  starts. The host must resolve only to public addresses. uier sends no cookies or credentials, follows
  no redirects, waits at most 5 seconds and reads at most 16 KiB of JSON. The document's `client_id`
  must equal its URL, and it needs a `client_name` and 1–10 acceptable redirect URIs. Logos, terms and
  policy links are ignored. A valid document is cached for its HTTP cache lifetime, clamped to between
  5 minutes and 24 hours; a failure is cached for 5 minutes.
- **Dynamic client registration.** `POST /api/oauth/register` takes `application/json` up to 16 KiB,
  without an initial access token. Unacceptable redirect URIs are dropped and the stored list is
  returned; registration fails with `invalid_redirect_uri` only when none remains. At most 10 are kept.
  The client name has control and formatting characters removed and is cut to 60 characters. The
  response is 201 with a `uier_client_…` id and no secret. A registration expires 30 days after the
  last sign-in that used it; existing connections keep working, and the client registers again for a
  new sign-in. A requested client authentication method is replaced with `none`.
- **Redirect URIs.** HTTPS URIs, or HTTP on `localhost`, `127.0.0.1` or `[::1]`, up to 512 characters.
  HTTPS URIs match exactly. Loopback URIs match with the port ignored and the scheme, host, path and
  query compared exactly, so clients can listen on any port. No custom schemes, fragments, user
  information or wildcard hosts.

### Authorization

`GET /api/oauth/authorize` resolves the client and its redirect URI first. An unknown client, a
redirect URI the client did not register, or a repeated `client_id` or `redirect_uri` shows a uier error
page (`/app/connect/error`) and never redirects. With a trusted redirect, errors go back to the client
with `state` and `iss`:

- `response_type` other than `code`: `unsupported_response_type`.
- PKCE: a `code_challenge` of 43 base64url characters with `code_challenge_method=S256` is required
  (`invalid_request`).
- `resource`, when sent, must be the MCP endpoint (`invalid_target`). It is compared after lowercasing
  the scheme and host and removing one trailing slash, never by prefix. A missing `resource` defaults to
  the MCP endpoint.
- `scope`: the five scopes above, space-separated; anything else is `invalid_scope`. No scope means
  `feedback:read`.
- `prompt=none`: `interaction_required`, because consent is always shown.
- A repeated parameter or a `state` over 1024 characters: `invalid_request`.

A valid request is stored for 10 minutes under a hashed random id, and the browser goes to consent
with a 303. The callback carries `code`, `state` and `iss`; a cancelled request carries
`error=access_denied`.

### Tokens

`POST /api/oauth/token` accepts only `application/x-www-form-urlencoded` up to 16 KiB, with no client
authentication, cookies or CORS. Responses send `Cache-Control: no-store`.

- `grant_type=authorization_code` needs `code`, `client_id`, `code_verifier` (43–128 characters) and the
  same `redirect_uri` as the authorization request, plus an optional `resource`. A second use of a code
  returns `invalid_grant` and revokes the connection that code created.
- `grant_type=refresh_token` needs `refresh_token` and `client_id`, plus optional `resource` and `scope`.
  Every refresh returns a new pair and retires the old refresh token. Presenting a retired refresh token
  within 60 seconds (a lost response or a concurrent refresh) returns another new pair. Presenting it
  later revokes the connection. `scope` may repeat or narrow the granted operations, always including
  `feedback:read`. Narrowing applies to the new access token only; a later refresh without `scope` returns
  every granted operation.

```json
{ "access_token": "uier_at.…", "token_type": "Bearer", "expires_in": 3600, "refresh_token": "uier_rt.…", "scope": "feedback:read feedback:reply" }
```

Errors use the RFC 6749 codes (`invalid_request`, `invalid_grant`, `invalid_scope`, `invalid_target`,
`unsupported_grant_type`). A code or refresh token from another client gets `invalid_grant`.

`POST /api/oauth/revoke` takes the same form encoding with `token` and an optional `client_id`, which
must match when sent. A refresh token ends its connection; an access token ends only itself. Unknown
tokens also get 200.

Tokens are opaque: `uier_at.<userId>.<random>` and `uier_rt.<userId>.<random>`, like `uier_mcp.*` access
tokens. The user id only selects a storage partition and grants nothing. Only SHA-256 hashes are
stored. Tokens, codes, verifiers, `state` and request bodies are never logged.

### Lifetimes

| What | Lifetime |
| --- | --- |
| Sign-in request (consent page) | 10 minutes, single use |
| Authorization code | 60 seconds, single use |
| Access token | 1 hour |
| Refresh token | Until its next use (then 60 seconds of grace), at most 30 days |
| Connection | Ends 30 days after the tool last refreshed, 1 year after it was created, or when revoked |
| Registered client | 30 days after the last sign-in that used it |
| Cached client metadata document | Its HTTP cache lifetime, between 5 minutes and 24 hours |
| Access token from Account | 30 days, or until revoked |

### Turning OAuth off

`UIER_MCP_OAUTH=off` in the server environment turns OAuth off. The discovery documents and every
`/api/oauth/*` route answer 404, and the 401 challenge returns to `Bearer realm="uier MCP"`. Access
tokens already issued stop working on their next request. Access tokens from Account are not affected. OAuth is on in every other case.

## Tools

| Tool | Scope | Behavior |
| --- | --- | --- |
| `list_projects` | `feedback:read` | Projects the connection can reach that the owner can still access, with their workspace; optional `workspaceId` filter |
| `list_feedback` | `feedback:read` | Routing summaries with page, environment, anchor, assignment, author kind, unread and screenshot filters within a 1000-thread window |
| `get_feedback` | `feedback:read` | Thread, anchor, original reproduction context and authorized screenshot reference |
| `get_feedback_batch` | `feedback:read` | The same full packets for 1–10 distinct thread ids, in request order, within 256 KiB |
| `list_assignees` | `feedback:assign` | Existing participants eligible to see the thread |
| `reply_to_feedback` | `feedback:reply` | Validated reply as the human account, labeled with the connection name |
| `set_feedback_status` | `feedback:status` | Resolve/reopen using the app's permission checks |
| `assign_feedback` | `feedback:assign` | Assign an existing authorized participant, or `null` to unassign |

All tools are listed for every connection. A call without the needed operation returns a `forbidden`
tool error ("This connection needs `<scope>`."); there is no step-up sign-in yet.

Every result includes `actingAs: { userId, name, credential, connection: { kind } }`. `credential` is
the connection name (kept for compatibility); `connection.kind` is `oauth` for a connected app and
`credential` for an access token from Account.

`list_projects` takes `limit`, `cursor` and an optional `workspaceId`, and returns
`{ actingAs, contentTrust, access, items, nextCursor }`. Each item is
`{ id, name, status, workspace: { id, name } }`, ordered by how long you have been a member of the
workspace, then by project name. `access` is `"all"` for a connection with all workspaces and projects,
otherwise `{ workspaces: <count> }` (always 1 for an access token). The listing scans at most 50
workspaces and 1000 projects; beyond that it adds `truncated: true` and a message to filter by
`workspaceId`. Project ids are globally unique, so every other tool, prompt and resource takes the
`projectId` alone; uier resolves its workspace and checks it against the connection on each call.

`get_feedback` returns `{ actingAs, contentTrust, context, markdown, screenshotResource? }`.
`context` and `markdown` come directly from the same authorized project export service as Copy
issue, using the shared [version 1 feedback context contract](feedback-context.md). The MCP
resource reference supplements its protected web image link when image access was granted.
Deleted first-message evidence is unavailable through both the packet and screenshot resource.

`list_feedback` items include canonical `path`, `environment: { id, label }`, `anchorType`,
`assignee: { id, name }` or `null`, `authorKind`, `unread` and `hasScreenshot`. Deleted first
messages omit `authorKind` and report no screenshot. The response includes project `environments`
options and `searchWindow: 1000`. Optional filters are `path`, `environment`, `anchorType`
(`point`, `text`, `page`), `assignee` (`me`, `unassigned`, or a member id), `authorKind`
(`member`, `guest`), `unread` and `hasScreenshot`, combined with `search` and `status`.
Paths use the project's page-state policy. Page and environment filtering happens in storage
before the window; other filters, including unread, only search that window. Environment accepts
only a returned option id, `unknown` or `removed`; omit it to search all environments.

`get_feedback_batch` takes `{ projectId, commentIds }` and returns
`{ actingAs, contentTrust, items, remainingIds }`. Each item contains `commentId` and either the
same `context`, `markdown` and optional `screenshotResource` as `get_feedback`, or an `error` and
`message`. Missing, deleted and inaccessible ids all return `not_found`. A packet too large for
one response returns `too_large` for that id. The batch returns only whole packets that fit within
256 KiB; retry `remainingIds` separately. Duplicate ids, empty batches and more than ten ids are
tool errors. Each packet loads its authorized thread, member names and saved screenshot document;
batching reduces transport calls, not these storage reads. Both tools leave read cursors unchanged.

Screenshot references are `uier://projects/{projectId}/feedback/{commentId}/screenshot` resources.
Use MCP `resources/read` with `screenshots:read` to retrieve the saved image; current feedback
visibility is checked again. References never contain a token or create a public image URL.
Clients control whether images/text they retrieve are sent to their own model provider. Revoking
access cannot retract data already received by a client.

Assignment uses the shared account id format `^u_[A-Za-z0-9_-]{1,64}$` (or `null` to unassign);
invalid ids produce an `invalid_request` tool error before participant reads or writes. Screenshot
resources report expected API errors with their code/message as MCP `InvalidParams`, malformed
resource arguments with fixed `InvalidParams` text, and unexpected failures as `InternalError`
with `The operation failed.` Storage details never appear in resource errors.
Transport handling has a 25-second deadline within the route's 30-second platform limit. Deadline
and request cancellation return JSON-RPC errors and close the server.

Responses mark feedback as `contentTrust: "untrusted"`; server instructions also identify text,
anchors, names and images as untrusted content. Clients must treat them as data and keep changes
user-initiated. The connector cannot edit code, run commands or deploy. A supported workflow is:
ask the client to read selected feedback, approve a code fix in the coding tool, then explicitly
approve its reply and status update. Tool annotations identify reads and mutations, but annotations
are hints, not an approval system. Reading does not acknowledge inbox unread activity.

## Prompts and agent skill

The connector exposes these user-selected MCP prompts:

| Prompt | Arguments | Behavior |
| --- | --- | --- |
| `triage-feedback` | `projectId` | Lists and groups open threads; changes nothing |
| `fix-feedback` | `projectId`, `commentId` | Reads a thread and proposes a code change in the client; leaves uier unchanged |
| `report-back` | `projectId`, `commentId` | Drafts a reply and/or status change; waits for approval before every write |

`report-back` is listed only with `feedback:reply` or `feedback:status` and names only the write
tools granted to that connection. Calling it without either scope is rejected. Prompt arguments
use the tools’ identifier schemas; project grants and current membership are checked on every
retrieval. Prompts contain instructions and validated identifiers, never feedback text: every
feedback read still goes through an authorized tool.

In **Prompts and agent skill**, copy or download `SKILL.md` and save it as
`uier-feedback/SKILL.md` in your client’s skills directory (see
[Codex skills](https://learn.chatgpt.com/docs/extend/skills) or
[Claude Code skills](https://code.claude.com/docs/en/skills)). Its `name` and `description` front
matter identify the workflow. It lists every tool with its required scope, treats feedback as
untrusted and requires approval before every write, including assignments. It contains no
token. `apps/web/src/lib/mcp/workflows.ts` generates both the prompt instructions and the
skill; update that source together with any tool contract changes.

## Limits

List tools accept `limit` (1–25, default 20; 100 is invalid) and numeric `cursor` (default 0), returning `nextCursor`
or `null`. Cursors are offsets in current results, so concurrent additions can shift a page. Search
is bounded to the latest 1000 threads; use known ids to read older feedback. Requests are limited
to 16 KiB and 120 per user per minute across all connections and access tokens. Replies also have a
30-per-connection, per-project hourly limit and consume the owner's 300-per-project hourly member
budget. Public feedback commenters retain their 30-reply visitor budget and shared IP limit. Exhausted
connections do not consume more of the owner's reply budget. Thread/image sizes retain existing review
validation limits. No server sessions or long-running streams are retained.

The OAuth routes count requests per hour:

| What | Limit |
| --- | --- |
| `/api/oauth/authorize` | 60 per IP address |
| Fetching one client metadata document host | 60 per host |
| Approving on the consent page | 30 per account |
| `/api/oauth/token` | 3000 per IP address (hosted clients share addresses) |
| Refreshing one connection | 120 per connection |
| `/api/oauth/register` | 20 per IP address, 2000 in total |
| `/api/oauth/revoke` | 120 per IP address |

An IP limit counts an IPv4 address or the /64 network of an IPv6 address. Local loopback requests are not
limited by IP.

A limit answers 429 with `temporarily_unavailable` and `Retry-After`. Counters are keyed hashes in the
comments container, deleted shortly after their window. Each account can have 20 active connected apps
and 20 access tokens.

## Retries and attribution

Every mutation requires an `idempotencyKey` (16–128 letters, numbers, `_` or `-`). Generate one per
intended action and reuse the same key and exact input after a timeout. Atomic 30-day receipts
prevent duplicate replies and prevent old status/assignment retries from overwriting subsequent
changes. Receipts belong to the connection, not to an access token, so a retry after a token refresh
still matches; a new connection (after reconnecting) starts with no receipts. Reusing a key with
different input returns a conflict. Do not retry an old intention with a new key automatically;
confirm it with the user again. Tool errors include stable error codes; rate limits include retry
guidance. Authentication errors return HTTP 401, invalid origins HTTP 403.

Replies retain the human author and the connection's name; status/assignment outbox events retain
the same attribution and use existing unread and notification rules. Stored attribution records the
connection id (the connected app or the access token) and whether it was OAuth. No notification bypass
is added.

## Tests

`e2e/mcp.api.spec.ts` uses the official SDK client for the read/fix/reply/status path and adversarial
isolation, image, expiry, revocation, membership and retry checks. `e2e/mcp.spec.ts` connects that
client to a token created in the real Account UI, verifies light/dark accessibility and revokes
access on the existing connection. `e2e/mcpOauth.api.spec.ts` covers OAuth: discovery and the off
switch, registration and metadata documents, authorization errors, consent, code exchange, refresh
rotation, expiry, revocation, access across workspaces, coexistence with access tokens, and the
official SDK client signing in, refreshing and losing access after revocation.
`e2e/mcpOauth.spec.ts` (main journey tagged `@smoke`) starts the SDK client's OAuth flow with dynamic registration and a loopback listener, signs in through the
authorization URL, chooses two workspaces and a write operation on the consent page, approves,
exchanges the code, lists projects (including one created after approval) and replies, then
revokes the app in Account and expects 401. The full suite adds cancel (`access_denied`), reuse of
a consumed request, Use another account, the error page, a 375 px layout and light/dark axe checks.
This feature does not close the separate MVP launch audit #90.
