# Coding tool access (MCP)

Connect a coding tool to the projects and operations you choose. For the shared feedback packet,
see [Feedback context](feedback-context.md).

In **Account → Coding agents**, give a credential a name, select up to 20 projects in the current
workspace, and choose operations. Read feedback is selected initially; screenshots, replies,
status changes and assignments each need an explicit scope. The app issues a 30-day credential,
shows the secret once, and lets its owner revoke it from any workspace. Store it outside source
control in the environment of your chosen client. Only a SHA-256 hash and the grant metadata are
stored. Removal of membership/project access and private visibility changes apply on the next
request. Public project codes, guest ids, review links and app cookies cannot authorize MCP.

The endpoint is `https://uier.io/api/mcp` (use your local/preview origin while testing). It uses the
[official TypeScript SDK's Streamable HTTP transport](https://ts.sdk.modelcontextprotocol.io/server),
stateless JSON responses, and a manually configured `Authorization: Bearer <credential>` header.
OAuth login/discovery and clients that require OAuth are not supported. **Client configuration**
in Account offers the following setups, built from the same endpoint. Merge entries into the
existing client file; keep the credential out of every file and URL. Set `UIER_MCP_TOKEN` in the
environment of the process that starts the client, then restart it.

**Codex** — `~/.codex/config.toml`. [Official bearer configuration](https://learn.chatgpt.com/docs/extend/mcp#streamable-http-servers):

```toml
[mcp_servers.uier]
url = "https://uier.io/api/mcp"
bearer_token_env_var = "UIER_MCP_TOKEN"
```

**Claude Code** — `.mcp.json`. [Official HTTP setup and variable expansion](https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcpjson):

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

Keep the reference literal. Do not use a shell-expanded bearer header with `claude mcp add`:
it saves the expanded secret in settings. Approve the project server when Claude Code asks.

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

**VS Code** is not offered because an actual client connection could not be verified in this
session. The [official configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)
documents HTTP headers and masked `promptString` inputs (`password: true`, `${input:...}`).
A documentation check alone does not verify a connection; there is no ready block until that check passes.

**Claude Desktop** is not offered in the picker without a verified connection. Its
[custom connector request headers](https://claude.com/docs/connectors/custom/add-unlisted#authenticate-with-request-headers)
are in beta for a limited set of organizations. Where available on an individual plan, add a
custom connector by the endpoint URL, choose **No sign-in**, and enter
`Authorization: Bearer <credential>` under **Request headers**. Claude connects from Anthropic’s
servers, so this cannot reach a local endpoint. Remove and add the connector again after expiry
or revocation; saved authentication cannot be edited. Team and Enterprise are not supported:
an Owner adds custom connectors for the whole organization, so a personal uier credential would
be shared. Without Request headers, Claude Desktop is unsupported until OAuth exists. Do not
use a third-party bridge.

**Windsurf** is not offered because a deployed client connection could not be verified here.
Its [current documentation](https://docs.devin.ai/desktop/cascade/mcp) describes legacy Cascade
in Devin Desktop, with `serverUrl` and `${env:UIER_MCP_TOKEN}` header interpolation. Documentation
alone is not a completed client connection check.

The credential belongs to the named human account. It grants no additional project or private
feedback rights. Its selected projects do not expand when new projects are created.

Use the owning `projectId` in the copied feedback packet, not an id found in the reviewed page URL.
Feedback about uier itself belongs to **uier.io public feedback** (`uier00000001`) in the **uier**
workspace, including feedback left while viewing another project's page. To connect a coding tool
to that feedback, switch to the uier workspace and create a credential with that project selected
and the operations you intend to use (including Change status to close feedback), then reconnect
your client. Credentials are bound to the workspace in which they were created; existing grants
are never expanded automatically. `list_projects` shows the current grant. An absent project or a
`not_found` response does not prove that feedback was deleted.

| Tool | Scope | Behavior |
| --- | --- | --- |
| `list_projects` | `feedback:read` | Selected projects still accessible to the owner |
| `list_feedback` | `feedback:read` | Routing summaries with page, environment, anchor, assignment, author kind, unread and screenshot filters within a 1000-thread window |
| `get_feedback` | `feedback:read` | Thread, anchor, original reproduction context and authorized screenshot reference |
| `get_feedback_batch` | `feedback:read` | The same full packets for 1–10 distinct thread ids, in request order, within 256 KiB |
| `list_assignees` | `feedback:assign` | Existing participants eligible to see the thread |
| `reply_to_feedback` | `feedback:reply` | Validated reply as the human account, labeled with the credential name |
| `set_feedback_status` | `feedback:status` | Resolve/reopen using the app's permission checks |
| `assign_feedback` | `feedback:assign` | Assign an existing authorized participant, or `null` to unassign |

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
visibility is checked again. References never contain a credential or create a public image URL.
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

The connector exposes these user-selected MCP prompts:

| Prompt | Arguments | Behavior |
| --- | --- | --- |
| `triage-feedback` | `projectId` | Lists and groups open threads; changes nothing |
| `fix-feedback` | `projectId`, `commentId` | Reads a thread and proposes a code change in the client; leaves uier unchanged |
| `report-back` | `projectId`, `commentId` | Drafts a reply and/or status change; waits for approval before every write |

`report-back` is listed only with `feedback:reply` or `feedback:status` and names only the write
tools granted to that credential. Calling it without either scope is rejected. Prompt arguments
use the tools’ identifier schemas; project grants and current membership are checked on every
retrieval. Prompts contain instructions and validated identifiers, never feedback text: every
feedback read still goes through an authorized tool.

In **Prompts and agent skill**, copy or download `SKILL.md` and save it as
`uier-feedback/SKILL.md` in your client’s skills directory (see
[Codex skills](https://learn.chatgpt.com/docs/extend/skills) or
[Claude Code skills](https://code.claude.com/docs/en/skills)). Its `name` and `description` front
matter identify the workflow. It lists every tool with its required scope, treats feedback as
untrusted and requires approval before every write, including assignments. It contains no
credential. `apps/web/src/lib/mcp/workflows.ts` generates both the prompt instructions and the
skill; update that source together with any tool contract changes.

List tools accept `limit` (1–25, default 20; 100 is invalid) and numeric `cursor` (default 0), returning `nextCursor`
or `null`. Cursors are offsets in current results, so concurrent additions can shift a page. Search
is bounded to the latest 1000 threads; use known ids to read older feedback. Requests are limited
to 16 KiB and 120 per user per minute across credentials. Replies also have a 30-per-credential,
per-project hourly limit and consume the owner's 300-per-project hourly member budget. Public feedback
commenters retain their 30-reply visitor budget and shared IP limit. Exhausted credentials do not consume
more of the owner's reply budget. Thread/image sizes retain existing review validation limits.
No server sessions or long-running streams are retained; GET/DELETE return 405 after authentication.

Every mutation requires an `idempotencyKey` (16–128 letters, numbers, `_` or `-`). Generate one per
intended action and reuse the same key and exact input after a timeout. Atomic 30-day receipts
prevent duplicate replies and prevent old status/assignment retries from overwriting subsequent
changes. Reusing a key with different input returns a conflict. Do not retry an old intention with
a new key automatically; confirm it with the user again. Tool errors include stable error codes;
rate limits include retry guidance. Credential errors return HTTP 401, invalid origins HTTP 403.
Replies retain the human author and credential attribution; status/assignment outbox events retain
the same attribution and use existing unread and notification rules. No notification bypass is added.

`e2e/mcp.api.spec.ts` uses the official SDK client for the read/fix/reply/status path and adversarial
isolation, image, expiry, revocation, membership and retry checks. `e2e/mcp.spec.ts` connects that
client to a credential created in the real Account UI, verifies light/dark accessibility and revokes
access on the existing connection. This feature does not close the separate MVP launch audit #90.
