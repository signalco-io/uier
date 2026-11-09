# Coding tool access (MCP)

Connect a coding tool to the feedback you choose. The endpoint is `https://uier.io/api/mcp` (use your
local or preview origin while testing). It uses the
[official TypeScript SDK's Streamable HTTP transport](https://ts.sdk.modelcontextprotocol.io/server)
with stateless JSON responses; [events](#events-webhooks-and-polling) reach a coding tool as signed webhooks or
by polling. For
the shared feedback packet, see [Feedback context](feedback-context.md).
The public overview of what an agent can do is [uier.io/features/ai](https://uier.io/features/ai).

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
  Assign feedback (which also lets the tool show itself as the [agent working on feedback assigned to
  you](#agents-working-on-feedback)). The operations the tool asked for are preselected; Claude Code asks for Read feedback.
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
existing connection. Deleting a project removes it from every connection and access token that
selected it; one left with nothing selected is revoked ([project deletion](project-deletion.md)).
Transferring a project to another workspace does the same, and ends its event subscriptions: connect
again and choose it in the new workspace ([project transfer](project-transfer.md)).

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
Feedback about uier itself belongs to the **uier** workspace, including feedback left while viewing
another project's page: **uier.io user feedback** (`uier00000002`) holds what signed-in accounts left
(the app's Give feedback too), and **uier.io public feedback** (`uier00000001`) what guests left. An OAuth connection reaches them
with "All my workspaces and projects", or when the uier workspace is among the chosen ones. An access
token reaches one only when it was created in the uier workspace with that project selected (and the
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
  response is 201 with a `uier_client_…` id and no secret. A registration that no sign-in has used
  expires after a day; after that it expires 30 days after the last sign-in that used it. Existing
  connections keep working, and the client registers again for a new sign-in. A requested client authentication method is replaced with `none`.
- **Redirect URIs.** HTTPS URIs, or HTTP on `localhost`, `127.0.0.1` or `[::1]`, up to 512 characters.
  HTTPS URIs match exactly. Loopback URIs match with the port ignored and the scheme, host, path and
  query compared exactly, so clients can listen on any port. No custom schemes, fragments, user
  information or wildcard hosts.

### Authorization

`GET /api/oauth/authorize` resolves the client and its redirect URI first. An unknown client, a
redirect URI the client did not register, or a repeated `client_id` or `redirect_uri` shows a uier error
page (`/app/connect/error`) and never redirects. The other errors below go back to the client with
`state` and `iss` only when its redirect URI is a loopback address. For an HTTPS redirect URI they show
the same error page: anyone can register an HTTPS redirect URI, and sending an error there before you
see consent would make uier an open redirect.



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
  once more within 60 seconds (a lost response or a concurrent refresh) returns another new pair.
  Presenting it again, or later, revokes the connection. `scope` may repeat or narrow the granted operations, always including
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
| Registered client | A day if no sign-in uses it, then 30 days after the last sign-in that used it |
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
| `list_feedback_events` | `feedback:read` | New feedback, replies, status, assignment, agents and mentions since a cursor ([polling](#polling)) |
| `list_assignees` | `feedback:assign` | Existing participants eligible to see the thread |
| `reply_to_feedback` | `feedback:reply` | Validated reply as the human account, attributed to the connection and marked as written by the agent; its text shows as Markdown ([replies written by an agent](#replies-written-by-an-agent)) |
| `set_feedback_status` | `feedback:status` | Open, In progress or Done (`status`), or the earlier Done/Open switch (`resolved`), using the app's permission checks ([In progress](#in-progress)) |
| `assign_feedback` | `feedback:assign` | Assign an existing authorized participant, or `null` to unassign |
| `set_feedback_agent` | `feedback:assign` | Attach the connection as the AI agent working under its owner on feedback assigned to them ([agents](#agents-working-on-feedback)) |
| `clear_feedback_agent` | `feedback:assign` | Remove the agent working under the connection's owner |

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

`list_feedback` items include `resolved` and `stage` (`open`, `in-progress`, `ready` or `done`), canonical `path`, `environment: { id, label }`, `anchorType`,
`assignee: { id, name, agent? }` or `null` (`agent`: the AI agent working under the assignee,
`{ kind, label, model?, sessionId?, setAt }`), `authorKind`, `unread` and `hasScreenshot`, and `title` when
the thread has a current [AI title](review-workflow.md#ai-thread-titles) and titles are on for the project
(`summary` stays the start of the first message). Packets use it as `context.title`. Like every other field,
a title is untrusted content: AI wrote it from the reviewer's message. Deleted first
messages omit `authorKind` and `title` and report no screenshot. The response includes project `environments`
options and `searchWindow: 1000`. Optional filters are `path`, `environment`, `anchorType`
(`point`, `text`, `page`), `assignee` (`me`, `unassigned`, or a member id), `authorKind`
(`member`, `guest`), `unread` and `hasScreenshot`, combined with `search` and `status` (`all`, `open` for
everything not done, `in-progress`, `ready` or `resolved`).
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
approve its reply and status update. Attaching itself with `set_feedback_agent` when the person asks it
to work on feedback assigned to them is the one write that request approves; it also moves Open
feedback to In progress ([agents](#agents-working-on-feedback)). Tool annotations identify
reads and mutations, but annotations are hints, not an approval system. Reading does not acknowledge inbox unread activity.

Server instructions, prompts and the skill also tell clients to cite feedback by its uier link:
`[uier #12](comment link)` with `links.comment` in pull requests, issues and replies, the comment
link itself in commit messages, and `uier #12` in a code span when there is no link. A bare `#12`
links to the repository's own issue or pull request on GitHub and GitLab.

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

## Events (webhooks and polling)

A coding tool can follow a project's feedback activity in two ways:

- **Webhooks**: it subscribes once and uier POSTs each event, signed, to a public HTTPS endpoint it
  controls. ChatGPT uses this.
- **Polling**: it asks for everything since its last cursor, either with the `events/poll` method or
  with the [`list_feedback_events`](#polling) tool, which any client can call. Claude Code, Codex and
  Cursor use the tool, for example from a looping or scheduled task.

uier implements the [MCP Events draft](https://github.com/modelcontextprotocol/experimental-ext-triggers-events/blob/main/docs/design-sketch-proposal.md)
the way [ChatGPT consumes it](https://developers.openai.com/plugins/build/mcp-events): `initialize`
advertises a top-level `events: {}` capability, and the same authenticated endpoint answers
`events/list`, `events/subscribe`, `events/unsubscribe` and `events/poll`. Push delivery
(`events/stream`) and the `gap` and `terminated` notifications are not offered. The extension is
proposed for MCP as [SEP-3415](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3415),
not yet accepted; expect changes when it is.

| Event | Arguments | Fires when |
| --- | --- | --- |
| `feedback.created` | `projectId` | New feedback is posted |
| `feedback.replied` | `projectId`, optional `commentId` | A reply is added |
| `feedback.status_changed` | `projectId`, optional `commentId` | Feedback is marked done or reopened, moved to In progress or back to Open, or a fix check is requested, confirmed, rejected or canceled |
| `feedback.assignment_changed` | `projectId`, optional `commentId`, optional `assignee: "me"` | Feedback is assigned or unassigned |
| `feedback.agent_changed` | `projectId`, optional `commentId`, optional `assignee: "me"` | An AI agent starts, changes or stops working on feedback under its assignee, also when a new assignment removes it ([agents](#agents-working-on-feedback)) |
| `feedback.mentioned` | `projectId` | Someone mentions the account of the connection |

Priority, text edits and deletions have no event. `events/list` returns each event's `inputSchema`
and `payloadSchema` as JSON Schema and `delivery: ["webhook", "poll"]`; the schemas only gain optional
fields, never lose or rename them.

**Subscribing.** `events/subscribe` takes `name`, `arguments`, `delivery: { mode: "webhook", url,
secret }` and an optional `ttlMs`. It needs `feedback:read` and a project the connection reaches; any
other project is `Forbidden`, without saying whether it exists. The URL must be public HTTPS on the
default port, without credentials, a fragment or an IP address. The secret is a
[Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)
secret: `whsec_` and the base64 of 24–64 random bytes, supplied by the client.

Before a connection's first subscription to a URL, uier POSTs a signed
`{"type":"verification","challenge":"..."}` and activates the subscription only when a `2xx` response
echoes `{"challenge":"..."}` (compared in constant time). A verification covers that connection and
URL for a day; at most 30 verifications per callback host and hour are sent.

A subscription is keyed by connection, URL, event and canonical arguments, so the same call again
refreshes the same `id` (`sub_` and 32 hex digits). A refresh may replace the secret; the previous one
also signs deliveries for five minutes. The grant, `refreshBefore`, defaults to a day and is between
five minutes and seven days; `ttlMs: null` (no expiry) also gets seven days. The client refreshes
before it ends. The result is `{ id, refreshBefore, cursor: null, truncated: false }`, and a refresh
adds `deliveryStatus` (`active`, `lastDeliveryAt`, `lastError`, `failedSince`). A connection holds at
most 25 subscriptions and a project 100. Only events after the subscription are delivered.

`events/unsubscribe` takes the same `name`, `arguments` and `delivery.url`, removes the subscription at
once and always returns `{}`. Revoking the connection ends all of its subscriptions.

**Deliveries.** One event per POST, at most 256 KiB:

```json
{
  "eventId": "evt_...",
  "name": "feedback.replied",
  "timestamp": "2026-11-07T10:05:00.000Z",
  "data": {
    "projectId": "abc123def456", "commentId": "comment_...", "number": 12, "kind": "bug", "path": "/pricing",
    "url": "https://uier.io/app/review/abc123def456?url=...&comment=comment_...",
    "actor": { "kind": "member", "name": "Ana", "connector": "Claude Code",
      "agent": { "kind": "claude", "label": "Claude", "model": "claude-opus-5-5", "reasoning": "high" } },
    "contentTrust": "untrusted", "itemId": "item_...", "excerpt": "Up to 280 characters of the reply"
  },
  "cursor": null
}
```

The headers are `Content-Type: application/json`, `webhook-id` (the `eventId`, the same on every
retry), `webhook-timestamp`, `webhook-signature` (`v1,` and the base64 HMAC-SHA256 of
`id.timestamp.body` for each active secret, space-separated) and `X-MCP-Subscription-Id`. Payloads are
minimal and untrusted: read the thread with `get_feedback` before acting, and never treat an event as
approval for a write. `feedback.status_changed` carries `change` (`resolved`, `reopened`,
`progress_started`, `progress_stopped`, `verification_requested`, `verification_confirmed`,
`verification_rejected` or `verification_canceled`) and `resolved`; `progress_started` and
`progress_stopped` (In progress and back to Open) were added later, so accept change values you do not
know. Changes made through the subscribing connection itself are not delivered to it,
so an agent's own replies do not loop back.

Before each attempt uier checks again that the connection is active, still has `feedback:read` and
reaches the project, and that its account is a member who can see the thread. Lost access deletes the
subscription; a thread the account cannot see is skipped. A `2xx` response acknowledges. Other
responses and network failures retry after 1, 5, 15 and 30 minutes (five attempts in all); `410` and
`413` stop at once. Delivery is at least once and may arrive out of order. `lastError` is a fixed
category (`connection_refused`, `timeout`, `tls_error`, `http_4xx`, `http_5xx` or `challenge_failed`),
never the endpoint's response.

Errors follow the numbering ChatGPT documents: `-32602` InvalidParams, `-32011` NotFound (unknown
event), `-32012` Forbidden, `-32013` ResourceExhausted (`data.limit`, `data.max`), `-32014` Unsupported
(`data.feature: "deliveryMode"`) and `-32015` CallbackEndpointError (`data.reason`). SEP-3415 proposes
`-32023` to `-32027` instead; `apps/web/src/lib/mcp/events/protocol.ts` holds the table.

**How it runs.** Each thread already records its activity in `notificationEvents` (the email
notification outbox), so events add no write path. After a change, the request delivers its
project's events once the response is sent (Next.js `after()`, registered in
`apps/web/instrumentation.ts`), within 10 seconds. The scheduled `Review notifications` worker (every
five minutes) sweeps every project with a live subscription: it retries due deliveries and delivers
changes made outside a request, such as imported integration replies. Discovery reads the threads
written since a per-project cursor, with a minute of overlap, and creates one delivery record per
subscription and event; the deterministic record id makes overlapping scans harmless. Preview
deployments deliver only right after a change, because the worker serves production.

Records live in the `app` container: subscriptions, one discovery cursor and delivery records (ids
and state only, seven days) in the project's `mcp-events:<projectId>` partition, and confirmed
endpoints in `mcp-events-endpoint:<connectionId>` for a day. A subscription record expires a minute
after `refreshBefore`. Secrets are encrypted (AES-256-GCM) with a key derived from
`UIER_COMMENTS_SECRET`; if that secret changes, deliveries stop until each client's next refresh
stores its secret again.

Local test runs accept `http://localhost` and `http://127.0.0.1` callbacks on any port when
`UIER_MCP_EVENTS_TEST_HTTP_CALLBACKS=1` is set in local runtime; never set it on a deployment.

### Polling

Polling keeps nothing on the server: the client holds an opaque cursor. Start with `cursor: null`,
which returns no events and a cursor that starts now (events of that same millisecond are included),
then pass the cursor from each answer to the
next request. Every answer returns the events since that cursor, oldest first (within a millisecond,
by thread and then the thread's own order), each at most once, and a new cursor. The cursor never ends; keep it between
checks.

`list_feedback_events` (`feedback:read`) takes `projectId`, optional `events` (event names; all when
omitted), optional `commentId`, `cursor` and `limit` (1–25, default 20). It returns
`{ actingAs, contentTrust, items, cursor, hasMore, truncated, nextPollMs }`; each item is
`{ eventId, name, timestamp, data }` with the same `data` as a webhook. One cursor covers all the
chosen events. In Claude Code, for example:

```text
/loop 5m Check uier project abc123def456 with list_feedback_events, keeping its cursor. Summarize new
feedback and replies, and propose fixes for new bugs. Don't reply or change status without asking me.
```

`events/poll` follows the draft: `name`, `arguments` (as for `events/subscribe`), `cursor`, optional
`maxEvents` (1–50, default 20) and `maxAgeMs`. It returns `{ events, cursor, truncated, hasMore,
nextPollMs }`, one event name per request.

- `hasMore: true`: more events are waiting; ask again at once with the new cursor.
- `nextPollMs` is 30 seconds, a suggestion. Requests count toward the limit of 120 per minute.
- `truncated: true`: events may have been skipped, so read the current state with `list_feedback`.
  That happens when the cursor is older than seven days or `maxAgeMs`, when more than 1000 threads
  changed since it (the feed starts again from now), or when more than 200 events arrive within one
  minute.
- A cursor this server did not issue is `InvalidParams` (`invalid_request` from the tool).

The same rules as webhooks apply: the connection needs `feedback:read` and must reach the project,
only threads its account can see now are included, its own changes are left out, and items are
untrusted. Each request reads the project's threads written since the cursor, less a minute; an
event committed up to that minute after its time is still returned once.

## Limits

List tools accept `limit` (1–25, default 20; 100 is invalid) and numeric `cursor` (default 0), returning `nextCursor`
or `null`. Cursors are offsets in current results, so concurrent additions can shift a page. Search
is bounded to the latest 1000 threads; use known ids to read older feedback. Requests are limited
to 16 KiB and 120 per user per minute across all connections and access tokens. Replies also have a
30-per-connection, per-project hourly limit and consume the owner's 300-per-project hourly member
budget. Public feedback commenters retain their 30-reply visitor budget and shared IP limit. Exhausted
connections do not consume more of the owner's reply budget. Thread/image sizes retain existing review
validation limits. No server sessions or long-running streams are retained; events are delivered by
webhook (see [Events](#events-webhooks-and-polling) for their limits).

The OAuth routes count requests per hour:

| What | Limit |
| --- | --- |
| `/api/oauth/authorize` | 60 per IP address |
| Fetching client metadata documents | 30 per IP address, 600 per publishing host |
| Approving on the consent page | 30 per account |
| `/api/oauth/token` | 3000 per IP address (hosted clients share addresses) |
| Refreshing one connection | 120 per connection |
| `/api/oauth/register` | 20 per IP address (IPv6 per /48), 2000 in total |
| `/api/oauth/revoke` | 120 per IP address |

An IP limit counts an IPv4 address or the /64 network of an IPv6 address. When a metadata fetch limit is reached, the
last valid document of that client (kept up to 30 days) is used, so nobody can block a client's
sign-in by spending the budget. Local loopback requests are not
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

Replies retain the human author and the connection's name, and are marked with the agent that wrote
them ([replies written by an agent](#replies-written-by-an-agent)); status/assignment outbox events retain
the same attribution and use existing unread and notification rules. Stored attribution records the
connection id (the connected app or the access token) and whether it was OAuth. No notification bypass
is added.

## Request logs

Every `/api/mcp` request writes one `mcp_request` JSON event (version 1) to the hosting logs, so
tools, prompts and resources can be improved from how clients actually use them: what they call,
which calls fail and why, and how large the answers are. `apps/web/src/lib/mcp/telemetry.ts` builds
the event and `mcpRequestEventSchema` (in `telemetrySchema.ts`, re-exported by `telemetry.ts`) is its
contract. Events with an unexpected failure are written
at error level, all others at info level. Find them by filtering the logs on `"event":"mcp_request"`.

The request part has the HTTP method and status, the duration, and an `outcome`:

| `outcome` | `error` |
| --- | --- |
| `handled` | none; the calls say how each message went |
| `rejected` | `sign_in_required` (with `authentication`: `missing` or `invalid`), `forbidden` (before authentication: the Origin check), `rate_limited`, `method_not_allowed`, `invalid_request`, `too_large`, `transport_error` (the SDK refused the request, for example a missing `Accept`) |
| `interrupted` | `timeout` or `cancelled` |
| `failed` | `server_error`, with `failure` |

It also has the protocol version, the client's own `name` and `version` (only on `initialize`) and,
once a connection is authenticated, its `kind`, granted `scopes`, `access` (`all` or `selected`) and
two keyed references: `ref` for the connection and `user` for the account. They are 16 hex digits of
an HMAC with the server secret, so requests of one connection can be followed across events, and
an operator who knows a connection id can find its requests, without the id in the logs.

`calls` has one entry per JSON-RPC message (at most 10; `omittedCalls` counts the rest):

- `method` and, for `tools/call`, `prompts/get`, `resources/read`, `events/subscribe`,
  `events/unsubscribe` and `events/poll`, the registered `name` (an event name for the last three), or `unknown` with
  `requestedName` when the client asked for a name we do not offer. Event calls log no arguments:
  never the callback URL, secret or filters;
- `outcome`: `success`, `tool_error` (an `isError` tool result), `error` (a JSON-RPC error, with
  `rpcError`), `accepted` (a notification) or `unanswered` (no answer was sent, for example after a
  timeout or a rejected request);
- `error`: the tool error code (`not_found`, `forbidden`, `rate_limited`, `conflict`, `too_large`, ...),
  `invalid_arguments`, `unknown_tool`, `unknown_prompt`, `unknown_resource`, `server_error` or a
  JSON-RPC classification (for events: `not_found`, `forbidden`, `resource_exhausted`, `unsupported`,
  `callback_failed`); `missingScope` when a connection lacks the operation, `reason` for limits;
- `issues` for rejected arguments: the field and the validation code (`too_big`, `invalid_type`,
  `invalid_format`, `unrecognized_keys`, ...) from the tool's or prompt's own schema;
- `arguments` (fields the schema declares) and `unknownArguments` (other names the client sent).
  Booleans, `null`, numbers in numeric fields and the fixed options a field declares (`status: "open"`,
  `priority`, `assignee: "me"`) are kept; every other value is only its type and length;
- `result`: `bytes` of the answer and, where the tool returns them, `items`, `more` (a `nextCursor`
  follows, or `hasMore` for event polling), `remaining` (batch ids to retry), `truncated` and
  `itemErrors` (per-thread batch errors); `events/poll` records `items`, `more` and `truncated`;
- `failure` for unexpected errors: the error class, a status code if the error has one and up to five
  code locations, never its message.

The events never contain feedback, replies, search text, page addresses, screenshots, project,
thread, workspace or account ids, connection or client-registration names, email addresses, tokens,
request bodies or raw error messages. Logging is best effort: a failing log sink never changes or
fails a response, and platform log loss or sampling can leave gaps. Events follow the hosting log
retention; export them for longer analysis before it expires.

Some starting points: `"error":"invalid_arguments"` with `issues` shows schema fields clients get
wrong; `requestedName` shows tools and prompts clients expect; `missingScope` shows operations
people did not grant; `itemErrors`, `remaining` and `bytes` show batches and answers that hit limits.

### Daily report

`scripts/mcp-report.mjs` summarizes one UTC day of one environment from a log export. Export the
hosting logs as NDJSON before their retention expires, one JSON object per line: raw `mcp_request`
events or Vercel JSON log objects whose `message` is an event. Other lines are skipped. Then run:

```bash
pnpm -C apps/web exec node scripts/mcp-report.mjs /absolute/path/mcp-logs.ndjson 2026-11-04 production
```

The environment is `production`, `preview`, `local` or `unknown`. The JSON report has:

- `requests`: the request count, counts by `outcome`, `error` and `authentication`, `durationMs`
  (p50, p95 and max) and the total of `omittedCalls`;
- `connections`: how many distinct connection `ref` and account `user` references made requests, and
  connection references by `kind`. The references themselves are not in the report;
- `clients`: the client `name` and `version` pairs from `initialize`, most frequent first;
- `calls`: one entry per `method` and `name` (the tool, prompt or resource, `null` for methods without
  one, `unknown` for names we do not offer) with the call count, counts by `outcome`, `error` and
  `missingScope`, the most frequent validation `issues` (`path` and `code`) and, when answers had a
  `result`, `bytes` (median, p95 and max) and how many had `more`, a non-zero `remaining`, `truncated`
  or `itemErrors` (with the item error codes summed);
- `requestedNames` (tools and prompts clients asked for), `unknownArguments` (per tool) and
  `serverErrors` (the `failure` class of `server_error` requests and calls, with the method and name);
- `rejectedRecords` (`mcp_request` records that do not match `mcpRequestEventSchema`) and
  `duplicateRecords` (the same event id exported twice, counted once).

Lists hold the 20 most frequent entries (10 for `issues`); the counts behind them are complete.
Records are validated with `mcpRequestEventSchema` and the report reads only the codes, registered
names, client labels, counts and sizes the schema allows. It never prints raw log lines, event ids,
connection or account references, or `failure` code locations, and its errors never quote the input.
Percentiles are nearest rank. Platform log loss or sampling can leave gaps, so treat the counts as
observed, not complete.

New tools, prompts and resources are logged without extra work: `createFeedbackMcpServer` lets the
request log watch every registration, which records its schema and runs its handler where
`noteMcpError` can find the request. A handler's catch block calls `noteMcpError(error)` before it
maps the error for the client. `e2e/mcpTelemetry.api.spec.ts` covers the events.

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
`e2e/mcpTelemetry.api.spec.ts` checks the request log: successful and failed calls, rejected and
interrupted requests, unexpected failures and a failing log sink, and that no content or id is logged.
`e2e/mcpEvents.api.spec.ts` runs event subscriptions against a local webhook receiver: the capability
and catalog, verification, Standard Webhooks signatures, filters, loop prevention, private threads,
refresh and secret rotation, unsubscribe, retries, `410`, revocation, error codes and what is logged,
plus polling: starting from now, each event once, a late commit, paging, visibility, the
`list_feedback_events` tool, invalid and expired cursors.
`e2e/assignee-agent.api.spec.ts` covers agents: only the assignee sets or clears one (other members,
admins and guests cannot), a new assignment or a private thread removes it, it is never emailed, and
the MCP tools attach a connection only under its owner (`assignToMe` only for unassigned feedback),
replay retries, and appear in `list_feedback`, packets and `feedback.agent_changed`.
`e2e/agent-replies.api.spec.ts` covers replies written by an agent: the attached agent's details when
it matches, what the connection gives otherwise, no mark on app and toolbar replies or from text, the
author's unchanged permissions, and the mark in app views, the toolbar's DTO, packets, emails and events.
`e2e/mcpEvents.spec.ts` creates a token in Account, subscribes, posts feedback to the running app and
expects the webhook right after the request, without the worker.
`e2e/mcp-report.api.spec.ts` checks the daily report on fixture events: raw and Vercel lines,
skipped, invalid and duplicate records, every aggregate, the command's output and errors, and that no
content, id or reference reaches the report.
This feature does not close the separate MVP launch audit #90.


### Feedback priority

`list_feedback` summaries and `get_feedback` / `get_feedback_batch` packets include the saved
priority (`low`, `normal`, `high`, `urgent`). Missing priority on legacy records means `normal`.
`list_feedback` accepts an optional validated `priority` filter, combined with its existing filters
within the authorized 1,000-thread window. Reads never acknowledge activity. The field is additive;
there is no dedicated MCP priority write in this version. Copy issue and provider packets include
priority as context without changing provider-native priorities, labels or other human-managed fields.

### In progress

A thread is Open, In progress, Ready to verify or Done ([review workflow](review-workflow.md#in-progress)).
`list_feedback` items and `get_feedback` / `get_feedback_batch` packets carry `stage` (`open`,
`in-progress`, `ready` or `done`) beside the unchanged `resolved` and packet `status` (`open` or
`done`), so In progress and Ready to verify stay open for existing clients. `list_feedback`
`status: "in-progress"` lists threads in progress; `status: "open"` still lists everything not done.

`set_feedback_status` takes exactly one of:

- `status`: `open`, `in-progress` or `done`. Ready to verify is a fix check request
  (`request_feedback_verification`). Leaving Ready to verify this way ends the check without
  confirmation, as Reopen does.
- `resolved`: the earlier switch, unchanged for existing clients. `true` is Done (it ends In
  progress); `false` reopens a Done thread to Open and leaves an In progress thread as it is.

Both and neither are `invalid_request`. The result is `{ actingAs, commentId, resolved, stage }`.
`cancel_feedback_verification` takes an optional `status` (`open` or `in-progress`); without it the
thread returns to where it was before the request. Its result adds `stage`. Who may set In progress
follows the app: the same people who mark the thread done or reopen it.

### Fix verification

`list_feedback` adds `status: 'ready'` (Ready to verify: a pending fix check) and display-only verification context. `get_feedback` and
batch reads include the same additive packet details as Copy issue. Their v1 `resolved` and
Open/Done fields remain compatible; Ready is unresolved. Reads do not acknowledge activity.

| Tool | Scope | Input and meaning |
| --- | --- | --- |
| `request_feedback_verification` | `feedback:status` | Thread ids, stable retry key, current `expectedRevision` (or null), `reviewerId` (`author` or eligible member id), optional summary/fix URL. Requests a check after explicit human approval. |
| `cancel_feedback_verification` | `feedback:status` | Thread ids, stable retry key, current revision and optional `status` (`open` or `in-progress`; without it, where the thread was before the request). Requester/admin cancels after explicit human approval. |

No confirmation operation is offered through MCP. `set_feedback_status` remains an ordinary
status write and never records reviewer confirmation. A pending check closed this way ends
unconfirmed. Tool descriptions, report-back prompts and the downloadable agent skill all require
approval of the exact operation and stable retry keys. Request/cancel attribution retains the
human connection owner and connection identity, including across token refresh.

### Agents working on feedback

The person a thread is assigned to can have one AI agent working under them: Claude, Codex, ChatGPT,
Cursor or a generic AI agent, with the session id, model and reasoning level it reported. The app shows its logo with
the assignee ([review workflow](review-workflow.md#ai-agents-under-the-assignee)). A coding tool
attaches itself when it starts working on feedback assigned to its owner:

| Tool | Scope | Input and meaning |
| --- | --- | --- |
| `set_feedback_agent` | `feedback:assign` | Thread ids, stable retry key, optional `agent` (`claude`, `codex`, `chatgpt`, `cursor` or `agent`), optional `sessionId` (up to 200 characters), `model` (up to 100) and `reasoning` (the reasoning level or effort, up to 32), optional `assignToMe`. Attaching moves Open feedback to In progress when the connection also has `feedback:status`. Calling it again updates the details; a detail it leaves out is cleared. |
| `clear_feedback_agent` | `feedback:assign` | Thread ids and stable retry key. Removes the agent, for example when the tool stops without finishing. |

Both return `{ actingAs, commentId, assigneeId, agent, stage }`, `agent` being `{ kind, label, model?, reasoning?, sessionId?, setAt }`
or `null` and `stage` the thread's status after the write (`open`, `in-progress`, `ready` or `done`).

- **Only under its owner.** The thread must be assigned to the connection's owner. Feedback assigned to
  someone else is `forbidden` for both tools, whoever the owner is (admins included): nobody puts an
  agent under another person, and a tool never reassigns feedback to make room.
- **Unassigned feedback** is `forbidden` ("Assign this thread to yourself first.") unless
  `assignToMe: true`, which assigns the owner and attaches the agent in one write. Pass it only when the
  person explicitly asked to take the feedback; the skill and tool description say so. It records the
  same assignment event as `assign_feedback`.
- **Attaching starts the work.** When `set_feedback_agent` attaches an agent to Open feedback (no agent
  was working under the owner before), the thread moves to In progress in the same write, when the
  connection also has `feedback:status`. It is an ordinary status change, recorded after the agent's:
  its own activity step, a `feedback.status_changed` event (`progress_started`), realtime refresh,
  integration sync, and the followers' email ("moved #12 to In progress", attributed to the
  connection). Feedback that is already In progress, Ready to verify or Done keeps its status, and
  updating the details, attaching again or `clear_feedback_agent` never change it. Without
  `feedback:status` the tool only attaches the agent, so a token without that scope never changes status.
- **The kind** is `agent` when given, otherwise inferred from what the connection calls itself (the
  connected app's or access token's name, its client id, the request's user agent): Claude, Codex, ChatGPT
  (or OpenAI) and Cursor, else AI agent. It only chooses a label and an avatar.
- **A new assignment removes the agent**: it belongs to the person it works under. The assignment and
  the agent leaving are one write, with a `feedback.agent_changed` event whose `agent` is `null` and
  whose `assignee` is the previous assignee. Making a thread private also removes an assignee who cannot
  see it, with their agent.
- The details are untrusted text from the tool or the person: one line, no control characters.
  `feedback.agent_changed` payloads add `assignee: { id, name }` (the person it works under, or `null`)
  and `agent: { kind, label, model?, reasoning?, sessionId? }` or `null` to the common fields.
- **The reasoning level** is short free text in the tool's own words (Claude's `low` to `max`, OpenAI's
  `minimal` to `high`), not a fixed list: providers name their levels differently and add new ones.
  Agents attached before it existed simply have none.
- Activity and attribution follow assignments: each change advances the thread's unread activity and
  records the connection as the connector. Agent changes are never emailed; the move to In progress
  that attaching can make is, like any status change.
- `get_feedback` packets name the agent beside the assignee (`context.assignee.agent`, and
  `Agent:`, `Model:`, `Reasoning:` and `Session:` in the Markdown). Connected services (GitHub, Linear, Notion, Slack,
  Azure DevOps) get the assignee's name only, never the agent.

### Replies written by an agent

A reply posted with `reply_to_feedback` is the connection owner's message, written for them by the agent
using the connection. uier marks it with that agent: the app and the toolbar show "You via Claude" or "Ana
via Claude" with the agent's logo and, for members, its model and reasoning level on hover; emails say
"Ana via Claude replied on #12" ([review workflow](review-workflow.md#messages-an-ai-agent-writes)).

| Input | Meaning |
| --- | --- |
| `agent` | Optional `claude`, `codex`, `chatgpt`, `cursor` or `agent`. Without it, the kind the connection identifies as, as for `set_feedback_agent`. |
| `model`, `reasoning` | Optional, the same one-line limits as `set_feedback_agent` (100 and 32 characters). Leave them out to use the attached agent's. |

- **The attached agent when it matches.** When an agent is attached under the connection's owner on
  that thread and it is the same kind, and the same model and reasoning level when the call names them,
  the reply takes that agent's model and reasoning level. Attaching yourself with `set_feedback_agent`
  first is enough.
- **Otherwise what the connection gives**: the kind, model and reasoning level of the call (the kind
  inferred when it gives none). A connection of someone other than the assignee always records its own.
- The agent is the provider vocabulary uier already uses (Claude, Codex, ChatGPT, Cursor, AI agent); the
  session id stays with the thread's agent and is not stored per message.
- The result adds `itemId` and `writtenBy: { kind, label, model?, reasoning? }` (a retry returns the
  message it saved). The mark is stored by the server, from the connection and the thread only, never
  from the text, and it does not change who may edit or delete the message. Replies posted before it
  existed keep the connection's name ("Ana via Claude Code").
- Packets add `agent: { kind, label, model?, reasoning? }` to the message and a **Written by agent:**
  line in the Markdown. `feedback.created`, `feedback.replied` and `feedback.mentioned` payloads add
  `actor.agent` with the same fields beside `actor.connector`. Connected services keep "Ana via Claude"
  as the author and never get the model.
- Fix check requests (`request_feedback_verification`) are not marked: their summary is part of the
  request, which keeps the connection's name as before.
- **Write Markdown.** The app's and the toolbar's threads show a message's text as Markdown: links,
  `code`, fenced code blocks, lists, bold, italic, strikethrough, quotes and headings (as bold text). Use
  absolute `https://` links, for example ``Fixed in [`abc1234`](https://github.com/org/repo/commit/abc1234)``.
  HTML is shown as typed, an image is a link to it, and a link that is not http, https or mailto (a
  relative path too) stays the text it was written as. Tables are not supported. Emails, list rows and
  connected services get the text as it was written ([Markdown in messages](review-workflow.md#markdown-in-messages)).
