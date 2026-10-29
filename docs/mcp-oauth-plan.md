# MCP OAuth: implementation plan

Status: phase 1 and production enablement shipped, with Claude Code as the only client offered with OAuth. OAuth is on in every deployment unless `UIER_MCP_OAUTH=off`. Claude (web, desktop and mobile), Codex, Cursor and VS Code keep manual access tokens until each passes live acceptance (section 13). Phase 3 (Edit access, step-up 403, manual credentials on the shared picker, a workspace policy) is not done. All ten decisions in section 16 were taken as recommended. [Coding tool access (MCP)](mcp.md) is the implemented contract; this plan stays as the design record, and [section 18](#18-implementation-notes) lists where the implementation differs from it.

## 1. Goal and scope

A person adds `https://uier.io/api/mcp` to an MCP client, the client opens a browser, the person signs in to uier and chooses what the client may reach and do, and the client receives tokens that it refreshes on its own. Nobody copies a secret into an environment variable or a config file, and nobody recreates a credential every month.

The current model broke in practice. Claude Code started without `UIER_MCP_TOKEN` and sent the unexpanded placeholder, which uier rejected with 401. A credential covers one workspace, so it could not reach `uier00000001` in the uier workspace while the person worked in their own. Every credential expires after at most 90 days (30 in the Account form). On 2026-10-29, a Claude Code session configured with a uier `Authorization` header also reported: "OAuth fallback is disabled when headers.Authorization is set". A configured header blocks the OAuth path even after uier supports it, so the client setup copy has to change together with the server.

Ships, in phases: protected resource and authorization server discovery; uier as its own OAuth 2.1 authorization server for the MCP endpoint only; client identification through Client ID Metadata Documents and dynamic registration; a consent screen in `/app`; short-lived access tokens with rotating refresh tokens in the existing Cosmos `app` container; connected apps listed and revocable in **Account → Coding agents** next to manual credentials; updated client setup for Claude Code, Claude (web, desktop and mobile), Codex, Cursor and VS Code once each is verified.

Manual `uier_mcp.*` credentials keep working unchanged. They remain the answer for headless environments (SSH sessions, containers, CI) where no browser can complete a loopback redirect.

Non-goals: uier as a general identity provider or OpenID Connect provider (no ID tokens, no `userinfo`, no sign-in with uier for other sites); OAuth for any route other than `/api/mcp`; the device authorization grant (RFC 8628); the `client_credentials` grant; client management endpoints (RFC 7592); confidential clients and `private_key_jwt` in the first release; token exchange or passing tokens to other services; changing what an MCP tool can do once access is granted.

## 2. How it works

```text
MCP client                         uier.io                                   browser
   | POST /api/mcp (no token)        |                                          |
   |-------------------------------->| 401 WWW-Authenticate: Bearer            |
   |<--------------------------------|   resource_metadata=".../.well-known/   |
   |                                 |   oauth-protected-resource/api/mcp"     |
   | GET protected resource metadata |                                          |
   | GET /.well-known/oauth-authorization-server                                |
   | (CIMD client_id URL, or POST /api/oauth/register)                          |
   | open /api/oauth/authorize?client_id&redirect_uri&state&code_challenge      |
   |   &code_challenge_method=S256&resource=https://uier.io/api/mcp&scope ----->|
   |                                 | validate client + redirect, store request|
   |                                 | 303 /app/connect/<requestId> ----------->|
   |                                 |        sign in if needed (?next=)       |
   |                                 |        consent: workspaces, projects,   |
   |                                 |        operations, connection name      |
   |                                 | <-------------------- approve (POST)    |
   |                                 | 200 return page -> redirect_uri?code    |
   |<-------------- code, state, iss (loopback listener or https callback) ----|
   | POST /api/oauth/token (code, code_verifier, redirect_uri, resource)        |
   |<-------------------------------- access token (1 h) + refresh token       |
   | POST /api/mcp Authorization: Bearer uier_at.…                              |
   |                                 | token -> grant -> current membership    |
   |                                 |   -> project access -> tool             |
```

The MCP route keeps its stateless Streamable HTTP transport, origin check, deadline and rate limit. Only `authenticateMcp` grows: it accepts either a manual credential or an OAuth access token, and both resolve to the same in-memory grant shape that `mcpProject` checks on every tool call and resource read. Access is never stored as a snapshot: each request intersects the grant with the person's current membership, team grants and private visibility, exactly as manual credentials do today.

Proposed files: `apps/web/src/lib/mcp/oauth/{metadata,clients,cimd,registration,authorize,consent,tokens,grants,redirects,errors}.ts`; route handlers `app/.well-known/oauth-protected-resource/api/mcp/route.ts`, `app/.well-known/oauth-authorization-server/route.ts`, `app/api/oauth/{authorize,token,register,revoke}/route.ts`; the consent page at `app/(rest)/(app)/app/connect/[requestId]/`; shared picker and connected-app list under `src/components/app/mcp/`. Add the pages to `src/knownPages.ts`.

## 3. Facts the design depends on

Checked on 2026-10-29. Everything after this section is a proposal.

**MCP authorization specification 2025-11-25** ([authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)):

- MCP servers MUST implement OAuth 2.0 Protected Resource Metadata ([RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728)) with at least one entry in `authorization_servers`, and MUST expose it through `resource_metadata` in the 401 `WWW-Authenticate` header or at a well-known URI. For an endpoint with a path, the path-specific URI is `/.well-known/oauth-protected-resource/<path>`; clients fall back to it, then to the root. Servers SHOULD include a `scope` parameter in the challenge, and clients treat it as authoritative.
- Authorization servers MUST publish [RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414) metadata or OpenID Connect Discovery. For an issuer without a path, clients try `/.well-known/oauth-authorization-server`, then `/.well-known/openid-configuration`.
- Client registration priority for clients: pre-registered information, then Client ID Metadata Documents when the server advertises `client_id_metadata_document_supported`, then dynamic client registration ([RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591)) when a `registration_endpoint` exists. Servers SHOULD support CIMD and MAY support DCR. The [draft revision](https://modelcontextprotocol.io/specification/draft/basic/authorization/client-registration) marks DCR as deprecated but kept for compatibility.
- For CIMD the server MUST check that the fetched document's `client_id` equals its URL, MUST validate redirect URIs against the document, SHOULD cache by HTTP cache headers and SHOULD guard against SSRF. CIMD cannot prevent localhost impersonation: any local process can present a legitimate client's `client_id` with its own loopback port. Servers SHOULD warn for loopback-only redirects and MUST clearly display the redirect URI hostname.
- Clients MUST use PKCE with S256 and MUST refuse to continue when `code_challenge_methods_supported` is missing. Clients MUST send `resource` ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html)) in authorization and token requests, set to the canonical server URI. Servers MUST only accept tokens issued for themselves and MUST NOT pass them through.
- Invalid or expired tokens get 401. Insufficient scope SHOULD get 403 with `error="insufficient_scope"`, the needed `scope` and `resource_metadata`, so the client can run a step-up authorization.
- Authorization servers SHOULD issue short-lived access tokens and MUST rotate refresh tokens for public clients. All endpoints MUST use HTTPS; redirect URIs MUST be `localhost` or HTTPS and match exactly against registered values.

**Claude** ([authentication for connectors](https://claude.com/docs/connectors/building/authentication)) shares one OAuth implementation across claude.ai, Claude Desktop, mobile, Cowork and Claude Code:

- A 401 is required to start sign-in; only the first `authorization_servers` entry is used; the protected resource `resource` must equal the URL as entered, including its path.
- CIMD is used only when the authorization server advertises both `client_id_metadata_document_supported: true` and `none` in `token_endpoint_auth_methods_supported`; otherwise Claude uses DCR, which registers a new client on every fresh connection.
- Hosted surfaces use the redirect URI `https://claude.ai/api/mcp/auth_callback`. Claude Code uses a loopback redirect on a per-session port and declares `http://localhost/callback` and `http://127.0.0.1/callback` in its [metadata document](https://claude.ai/oauth/claude-code-client-metadata), so both need a port-agnostic match.
- Claude always sends S256 PKCE, requests the challenged `scope` (otherwise `scopes_supported`) and appends `offline_access` only when the authorization server lists it. It refreshes on 401 and up to five minutes before expiry, expects `invalid_grant` for a dead refresh token and the new refresh token in the same response that invalidates the old one. The token endpoint must accept `application/x-www-form-urlencoded`. Discovery, registration and token endpoints get 10 seconds, refresh 30 seconds. Hosted traffic comes from `160.79.104.0/21`.

**Other clients.** These come from community reports and vendor pages, not official documentation; each needs the live acceptance in section 13 before uier offers a setup block.

- Cursor's DCR request has been reported to list `cursor://anysphere.cursor-mcp/oauth/callback`, a cursor.com cloud callback and `http://localhost:8787/callback` in one registration, with loopback as the current default ([Cursor forum](https://forum.cursor.com/t/mcp-oauth-redirect-uri-mismatch-in-cursor-desktop/171867), [report on 3.14.27](https://forum.cursor.com/t/cursor-mcp-dcr-still-omits-application-type-and-uses-a-non-rfc-8252-compliant-private-redirect-uri-3-14-27/167608)).
- Codex logs in with `codex mcp login <server>`, listens on `127.0.0.1` on an ephemeral port unless `mcp_oauth_callback_port` is set, and appends a path to its callback ([configuration mirror](https://www.mintlify.com/openai/codex/configuration/mcp-servers)).
- VS Code supports CIMD and has been observed with `http://127.0.0.1:33418` and `https://vscode.dev/redirect` ([den.dev](https://den.dev/blog/cimd-vs-code-mcp/)).

**MCP TypeScript SDK 1.32.2** ([tag `1.32.2`](https://github.com/modelcontextprotocol/typescript-sdk/tree/1.32.2/src/server/auth)), the version `apps/web` pins:

- Server auth helpers (`mcpAuthRouter`, `mcpAuthMetadataRouter`, `authorizationHandler`, `tokenHandler`, `requireBearerAuth` with the new `expectedResource`) are Express routers and middleware. They do not fit Next.js route handlers, and the server side has no CIMD fetching or validation. `redirectUriMatches` in `handlers/authorize.js` implements the RFC 8252 loopback port relaxation, but its module imports Express.
- Reusable without Express: the Zod schemas in `@modelcontextprotocol/sdk/shared/auth.js` (`OAuthProtectedResourceMetadataSchema`, `OAuthMetadataSchema` with `client_id_metadata_document_supported`, `OAuthClientMetadataSchema`, `OAuthTokensSchema`, `OAuthTokenRevocationRequestSchema`), `resourceUrlFromServerUrl` in `shared/auth-utils.js`, and the `AuthInfo` type that `WebStandardStreamableHTTPServerTransport.handleRequest(request, { authInfo })` forwards to handlers. `checkResourceAllowed` is a path-prefix match, so it is not an audience check.
- The SDK client (`client/auth.js`) runs the whole flow in tests: discovery, CIMD when `clientMetadataUrl` is an HTTPS URL and the server advertises support, otherwise DCR, PKCE, `resource`, refresh and `invalid_grant` handling. It adds `prompt=consent` whenever it requests `offline_access`.

## 4. Grant model: the decision this plan needs

Today a grant is one workspace and a fixed list of up to 20 projects, chosen when the credential is created, never expanded. The owner wants one connection to reach every workspace, every project and every operation. OAuth does not decide this; it only changes how the client obtains the token. The model has to be chosen first because it shapes the consent screen, the stored grant and two tools.

MCP clients store one token set per server URL. A model that needs several grants to reach several workspaces therefore needs several server URLs (for example `/api/mcp/w/<workspaceId>`, each with its own protected resource metadata), or a reconnect whenever the person switches workspace.

| Option | One connection reaches | Grows later | Exposure if the client, model or token is misused | Tool changes |
| --- | --- | --- | --- | --- |
| A. One workspace, chosen projects (today) | Chosen projects in one workspace | No | Smallest: one workspace | None. Several workspaces need several server entries with per-workspace URLs, or reconnecting |
| B. Several chosen workspaces, each with chosen projects or "all projects, including new ones" | Chosen workspaces; within a workspace marked "all", every current and future project the person can access | Only inside workspaces marked "all" | Medium: every chosen workspace | `list_projects` spans workspaces; workspace label in results |
| C. Everything: all current and future workspaces and projects | Everything the person can access in uier, now and later | Yes, including workspaces joined later (for example as an external reviewer of a client) | Largest: everything the person can see, including the public feedback project where anyone can write | `list_projects` spans workspaces with a `workspaceId` filter |

All three keep the existing ceiling: a grant never exceeds what the person can currently do in the app. Removal from a workspace, a lost team grant or a private thread still takes effect on the next request. The trade-offs are about the client and its model, not the person:

- **Blast radius.** A leaked refresh token, a compromised client or a misbehaving agent reaches whatever the grant covers until it is revoked or idles out. With C that includes workspaces the person joins months later without thinking about the coding tool.
- **Prompt injection across boundaries.** Feedback is untrusted. Guests can write in guest-enabled projects, and anyone can write in `uier00000001`. An agent holding read access to a private client workspace and reply access to a guest-visible project has a channel to copy one into the other. This already exists within one workspace today; B and C extend it across workspaces. The server cannot tell an approved reply from an injected one; the defenses are human approval in the client, write operations off by default, and a consent warning.
- **Other people's workspaces.** A person who is an external reviewer in a client's workspace brings that workspace into a C grant automatically. The workspace's admins have no say today. A workspace policy for coding agents (decision 7) is the eventual control.
- **Comprehension.** "Everything, including new workspaces" is easy to understand and to revoke. A per-workspace matrix is precise but slower to read on a phone.

**Recommendation.** Store one access shape that covers all three, and offer B and C on the consent screen:

```ts
type AgentAccess =
    | { kind: 'all' }                                  // C: every current and future workspace and project
    | { kind: 'selected'; workspaces: Array<{
          workspaceId: string;
          projects: 'all' | string[];                  // 'all' = current and future projects in this workspace
      }> };                                            // A is one entry with a project list
```

The consent screen offers "All my workspaces and projects, including new ones" and "Choose workspaces and projects", with C selected by default, because reaching everything is what the owner asked for and access is still evaluated live. Operations stay least-privilege by default: the scopes the client requested are preselected (the 401 challenge requests `feedback:read`), the others are one click away, with a "Select all operations" shortcut. When a grant combines any write operation with more than one workspace or with guest-commentable projects, the consent screen says so: "Feedback can contain instructions from people outside your team. Approve every reply and status change in your coding tool." Operations are per grant, not per workspace, in the first release (decision 3).

**What changes in the MCP surface.**

- Project ids are already globally unique: `findProject` resolves `project-ref` to its workspace with one point read. `get_feedback`, `get_feedback_batch`, `list_feedback`, `list_assignees`, all writes, prompts and the `uier://projects/{projectId}/…` resources keep their arguments. `mcpProject` resolves the workspace from the project, checks that the grant covers `(workspaceId, projectId)`, then runs the existing `memberActor` access check.
- `list_projects` returns `{ id, name, status, workspace: { id, name } }`, ordered by membership age and project name, with an optional `workspaceId` filter, and a top-level `access` summary (`all` or the number of chosen workspaces). For `all`, it enumerates memberships through a helper extracted from `getAppContext` (including the automatic uier workspace membership and the staff allowlist), then applies the `listVisibleProjects` rule per workspace with one access snapshot each. Bound the scan, for example at 50 workspaces or 1000 projects, and ask for `workspaceId` beyond that.
- `actingAs` keeps `credential` (the connection name) for compatibility and gains `connection: { kind: 'oauth' | 'credential' }`.
- The not-found message, server instructions, `feedbackAccessGuidance` and the generated `SKILL.md` stop telling people to switch to the uier workspace and create a credential there; they say to add the project to the connection in Account, or reconnect.
- With option A only, none of the above changes, and the Account copy keeps explaining per-workspace setup.

Manual credentials keep their current shape (one workspace, up to 20 projects) in the first release and are converted internally to `{ kind: 'selected', workspaces: [{ workspaceId, projects }] }`. Letting them use the same picker is phase 3 (decision 8).

## 5. Authorization server: uier or an external provider

| | uier as its own authorization server | External provider (for example Auth0, WorkOS AuthKit, Stytch, Descope, Keycloak) |
| --- | --- | --- |
| Identity | Existing users, email link/code sign-in and sessions | A second identity, linked to uier users by email; account linking and email changes become a new risk |
| Consent | Native page with workspace, project and operation choices | Provider consent knows nothing about workspaces; needs a redirect back to a uier page anyway |
| CIMD and DCR | Built here; small, testable surface | Varies by provider and plan; must advertise both CIMD values for Claude |
| Tokens and revocation | Opaque tokens in Cosmos, revocation effective on the next request | Usually JWTs: revocation waits for expiry unless every request calls introspection |
| Operations and privacy | No new vendor, secret or subprocessor | New vendor, cost, egress, uptime dependency and privacy-policy change |
| Security burden | uier owns OAuth correctness | Provider owns most of it |

**Recommendation: uier is its own authorization server, on the same origin.** The issuer is the app base URL (`https://uier.io` in production, the preview or local origin elsewhere), so `issuer`, endpoints and the protected resource share one host and Claude's first-entry rule is trivially satisfied. The deciding factors are the uier-specific consent (section 4), immediate revocation and not adding an identity system. The cost is owning a security-sensitive component; sections 9, 12 and 13 keep it small: one grant type, one client type, opaque tokens, no OpenID Connect, no Express and no OAuth framework. Use the SDK's shared schemas and the SDK client in tests. Do not adopt a general provider library such as `oidc-provider` (Koa-based, OpenID Connect scope, its own persistence model).

## 6. Discovery

`GET /.well-known/oauth-protected-resource/api/mcp` (only the path-specific document; a root document would have to describe another resource, which RFC 9728 forbids):

```json
{
  "resource": "https://uier.io/api/mcp",
  "authorization_servers": ["https://uier.io"],
  "scopes_supported": ["feedback:read", "screenshots:read", "feedback:reply", "feedback:status", "feedback:assign"],
  "bearer_methods_supported": ["header"],
  "resource_name": "uier"
}
```

`GET /.well-known/oauth-authorization-server`:

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

Build both from `appBaseUrl()` and validate them with the SDK schemas in tests. Serve them with `Content-Type: application/json`, `Access-Control-Allow-Origin: *` (public, no credentials) and `Cache-Control: public, max-age=300`. `offline_access` is not listed: every grant gets a refresh token, a requested `offline_access` is accepted and ignored, and a `prompt=consent` is satisfied because consent is always shown. Next.js route folders under `app/.well-known/` need a build check; if they do not route, use a rewrite in `next.config.ts`.

`/api/mcp` 401 responses change from `Bearer realm="uier MCP"` to:

```text
WWW-Authenticate: Bearer realm="uier MCP", resource_metadata="https://uier.io/.well-known/oauth-protected-resource/api/mcp", scope="feedback:read"
```

When a token was presented and is unknown, expired, revoked or issued for another resource, add `error="invalid_token"`. The body stays the existing JSON error with copy that covers both paths: "Sign in again from your coding tool, or use an unexpired access token from Account." The origin check keeps answering 403 before authentication.

Advertise discovery only where the full flow works. Gate the metadata routes and the new header together, on in local and preview deployments first and in production only after phase 2 acceptance. A client that finds metadata but cannot finish sign-in is worse than today's 401.

## 7. Client identification

**Client ID Metadata Documents (preferred).** A `client_id` that is an `https:` URL with a path, no query, fragment or credentials, a DNS host name (no IP literal) and port 443 is fetched at authorization time:

- Resolve the host and refuse private, loopback, link-local, CGNAT, multicast and reserved addresses; send no cookies or credentials; follow no redirects; 5-second timeout; at most 16 KiB; JSON only. In local test runs only, an explicit test switch may allow `http://localhost` metadata URLs; production never does.
- Validate with `OAuthClientMetadataSchema`, then require `client_id` to equal the URL exactly, a `client_name`, 1–10 `redirect_uris` that each pass section 8's rules, `token_endpoint_auth_method` absent or `none`, `grant_types` within `authorization_code` and `refresh_token`, and `response_types` of `code`. Ignore logo, terms and policy URLs: the consent page loads no remote images (`img-src 'self'` stays) and shows text only.
- Cache the validated document in an `mcp-client` record for the HTTP cache lifetime, clamped to between 5 minutes and 24 hours; cache failures for 5 minutes. Rate-limit fetches per requesting IP and per metadata host.

**Dynamic client registration (compatibility).** Codex, Cursor and clients that predate CIMD still need it, and Claude falls back to it if CIMD is misconfigured. `POST /api/oauth/register` accepts RFC 7591 JSON without an initial access token, up to 16 KiB, validated with `OAuthClientMetadataSchema`:

- Keep only redirect URIs allowed by section 8 and return the stored list, as RFC 7591 permits. A custom scheme such as `cursor://…` is dropped rather than failing the whole registration; registration fails only when no valid URI remains. At most 10 URIs of up to 512 characters.
- Force `token_endpoint_auth_method: none`; issue no secret and no `registration_access_token`. Store `client_name` normalized (control and bidirectional override characters removed, 60 characters).
- Return `client_id` `uier_client_<nanoid>`. The registration expires 30 days after its last authorization unless a grant uses it. Limit registrations per IP (proposed 20 per hour) and globally.

**How consent presents a client.** The name always comes from the client, so the page never presents it as verified identity:

| Client | Shown as | Extra notice |
| --- | --- | --- |
| CIMD, HTTPS redirect | Name, "published at" the `client_id` host, "sends you back to" the redirect host | None when the hosts match; the redirect host is emphasized when they differ |
| CIMD, loopback redirect | Name, "published at" the `client_id` host, "sends you back to this computer" | "Only continue if you just started this from a coding tool on this computer. Any program on this computer can use this name." |
| DCR | Name with an **Unverified** badge, "sends you back to" the redirect host or this computer | "uier cannot confirm who made this app. Its name was supplied by the app." plus the loopback notice when relevant |

The same text appears in Account for each connected app. A short allowlist of known metadata hosts with a "known publisher" label is possible later; it would describe the metadata document's host, never the program that sent the request.

## 8. Authorization request and consent

**Redirect URIs.** HTTPS URIs match the registered value exactly. Loopback URIs (`http` with host `127.0.0.1`, `[::1]` or `localhost`) match the registered URI with the port ignored and scheme, host, path and query compared exactly, which covers Claude Code's portless metadata entries and ephemeral ports. Nothing else is accepted: no custom schemes, no fragments, no user information, no wildcard hosts.

**`GET /api/oauth/authorize`.** Not under `/app`: the proxy would otherwise copy `client_id`, `redirect_uri`, `state` and `code_challenge` into the sign-in `next` parameter, which is limited to 2048 characters and should never carry OAuth parameters.

1. Resolve the client (CIMD fetch or registration) and the redirect URI. If either fails, render a uier error page and never redirect.
2. With a trusted redirect, return errors to it with `state` and `iss`: `response_type` other than `code`; missing `code_challenge`, a method other than `S256` or a challenge that is not 43 base64url characters; `resource` other than the canonical `https://uier.io/api/mcp` (`invalid_target`; compare after lowercasing scheme and host and removing one trailing slash, never by prefix); unknown scopes (`invalid_scope`); `prompt=none` (`interaction_required`).
3. A missing `resource` defaults to the only protected resource; the token still records it (decision 10).
4. Store an `mcp-authorization-request` with a hashed random id and a 10-minute TTL, and redirect `303` to `/app/connect/<requestId>`. Only this id passes through sign-in.

**Consent page `/app/connect/[requestId]`.** A server component behind the existing session redirect, built from `src/components/ui` (`Card`, `Field`, `RadioGroup`, `Checkbox`, `Badge`, `Alert`, `Input`, `Button`) per the shadcn skill. It shows:

- "Connect Claude Code to uier", the signed-in email and "Use another account".
- The client presentation from section 7.
- Access: the two choices from section 4 and, for "Choose", a workspace list with "All projects, including new ones" or individual projects per workspace. Workspaces and projects come from the person's memberships and the `listVisibleProjects` rule; no project from another account appears.
- Operations: the five existing scopes with their Account labels, requested ones preselected, plus "Select all operations".
- Connection name, prefilled from the client name, 1–60 characters, the same validation as the credential label today. This is the label replies and status changes carry.
- If the person already has a connection from the same `client_id`, or one with the same name, an option to replace it, selected for the same `client_id`.
- "Allow access" and "Cancel". Cancel returns `error=access_denied`.

Extract the project and operation picker from `McpCredentials.tsx` into one shadcn component used by consent, Account editing and (phase 3) the manual credential form; the current form still uses `@signalco/ui-primitives` controls, which `/app` should not. Copy follows `BRAND.md`: sentence case, short sentences, no exclamation marks.

Approval is a server action that rechecks the session user, reloads the request (unexpired, unused), validates every chosen workspace and project against current access, consumes the request with its etag and creates an authorization code (section 9). It then renders a same-origin return page, "Returning to Claude Code. You can close this tab.", which navigates to `redirect_uri?code=…&state=…&iss=https%3A%2F%2Fuier.io` with a nonce script and offers the same link without JavaScript. A redirect straight from the form submission is not used: `form-action 'self'` in `proxy.ts` also applies to redirects after a form post, so a 303 to a loopback or `claude.ai` callback would be blocked, and widening `form-action` per request is not worth it. Test the return in Chromium and WebKit.

Consent is shown every time, including reconnects by the same client; there is no silent approval in the first release (decision 9).

## 9. Tokens, lifetimes and storage

All records live in the existing Cosmos `app` container. Grants and tokens share the user partition already used by manual credentials, so the Account list is one partition query and every token operation is one transactional batch.

| Record | Partition / id | Fields | Lifetime |
| --- | --- | --- | --- |
| `mcp-client` | `mcp-client:<sha256(client_id)>` / same hash | Kind (`cimd`, `dcr`), `client_id`, normalized name, metadata host, redirect URIs, cache or last-use time | CIMD: cache lifetime; DCR: 30 days after last use |
| `mcp-authorization-request` | `mcp-authz:<sha256(id)>` / same | Client id, redirect URI, `state`, code challenge, requested scopes, resource | 10 minutes, single use |
| `mcp-code` | `mcp-user:<userId>` / `sha256(code)` | Client id, redirect URI, code challenge, resource, the approved access, scopes, name and replace choice; `consumedAt` and `grantId` after use | 60 seconds; consumed codes kept 10 minutes for replay detection |
| `mcp-grant` | `mcp-user:<userId>` / `grant_<nanoid>` | Client id and presentation snapshot, connection name, `AgentAccess`, scopes, `createdAt`, `updatedAt`, `lastUsedAt`, `idleExpiresAt`, `absoluteExpiresAt` | Idle 30 days, absolute 1 year (decision 4) |
| `mcp-access-token` | `mcp-user:<userId>` / `sha256(token)` | Grant id, client id, resource, optional narrowed scopes, `expiresAt` | 1 hour |
| `mcp-refresh-token` | `mcp-user:<userId>` / `sha256(token)` | Grant id, client id, resource, `rotatedAt`, `expiresAt` | Until rotated (plus 60-second grace) or idle expiry |

**Formats.** `uier_at.<userId>.<43 random characters>` and `uier_rt.<userId>.<43 random characters>`, with `randomToken()`; codes `uier_code.<userId>.<random>`. As with `uier_mcp.*`, the user id only selects a partition and grants nothing. Tokens are opaque; only their SHA-256 is stored, which suffices for 256-bit random values and matches `credentials.ts`. Never log tokens, codes, verifiers, `state` or token request bodies. Responses carry `Cache-Control: no-store`.

**Code exchange.** `POST /api/oauth/token`, `application/x-www-form-urlencoded` only, 16 KiB, no cookies consulted, no CORS. For `authorization_code`: the code exists, is unexpired and unconsumed; `client_id` and `redirect_uri` equal the stored values; `SHA-256(code_verifier)` equals the challenge (verifier 43–128 characters); `resource`, when sent, equals the stored one. One transactional batch marks the code consumed (etag), creates the grant, the access token and the refresh token, and deletes a replaced grant with its tokens. A second use of a consumed code returns `invalid_grant` and revokes the grant it produced (OAuth 2.1 §4.1.3). Errors use RFC 6749 codes (`invalid_grant`, `invalid_client`, `invalid_request`, `invalid_scope`, `invalid_target`, `unsupported_grant_type`); `invalid_client` returns 401. Response:

```json
{ "access_token": "uier_at.…", "token_type": "Bearer", "expires_in": 3600, "refresh_token": "uier_rt.…", "scope": "feedback:read feedback:reply" }
```

**Refresh.** Every use rotates. Read the refresh token and its grant; require matching client and resource, an active grant and no idle or absolute expiry; then in one batch mark the old token rotated, create the new pair and extend `idleExpiresAt` (and `lastUsedAt`). A rotated token presented again within 60 seconds is treated as a lost response or a concurrent process: it gets another new pair, and the grant stays. After 60 seconds, reuse revokes the whole grant and answers `invalid_grant`. An etag conflict re-reads once, which turns concurrent refreshes into the grace path. A `scope` parameter may repeat or narrow the granted scopes; narrowing is recorded on the new access token only.

**Revocation.** `POST /api/oauth/revoke` (RFC 7009) with `token` and `client_id`: a refresh token revokes its grant; an access token deletes only itself; unknown tokens still answer 200. Revoking from Account deletes the grant. Access tokens are validated against their grant on every request, so deleting the grant is enough; token documents may expire by TTL, with a best-effort delete by `grantId` in the same partition (confirm the container indexes it).

**Limits.** At most 20 active connected apps per user, separate from the 20 manual credentials; consent asks to replace or revoke one at the limit. Proposed endpoint limits with the existing `consume` counters: authorize 30 per user and 60 per IP per hour; token 120 per grant and 600 per IP per hour; failed token attempts 30 per IP per hour; registration as in section 7. Keep each endpoint to a few point reads and one batch, well inside Claude's 10- and 30-second budgets.

## 10. MCP endpoint changes

`authenticateMcp` dispatches by prefix. `uier_mcp.` keeps today's path. `uier_at.` reads the access token, checks expiry and that `resource` equals the canonical resource, reads the grant and checks it is active and unexpired, then loads the user. Refresh tokens, codes and anything else get 401 with the section 6 challenge. Both paths return one identity:

```ts
type McpIdentity = {
    user: DbUser;
    connection: { id: string; kind: 'credential' | 'oauth'; name: string; clientId?: string };
    scopes: McpScope[];      // grant scopes, intersected with narrowed token scopes
    access: AgentAccess;
};
```

Pass the same information as `authInfo` to `transport.handleRequest`, though tools keep receiving the identity through `createFeedbackMcpServer`. Update `lastUsedAt` at most once per hour per grant with a conditional write.

- **Step-up.** For OAuth identities, `handleMcp` already parses the JSON-RPC body. A `tools/call` or `resources/read` that needs a scope the grant lacks returns HTTP 403 with `WWW-Authenticate: Bearer error="insufficient_scope", scope="<granted and required scopes>", resource_metadata="…"`, so the client can run a new consent with that scope preselected. Manual credentials keep the current tool error, since they cannot step up. All tools stay listed; descriptions name their scope. Phase 3, after checking each client's step-up behavior.
- **Attribution.** `AgentSource` keeps `credentialId` (now the grant id for OAuth, unchanged for credentials) and `name` (the connection name confirmed at consent), and gains an optional `kind`. No stored comments are migrated. Replies, status and assignment events and notifications show the name as they do today.
- **Idempotency.** The mutation key hash changes from the credential id to the connection id, which for OAuth is the grant id. It must not use the access token, so that a retry after a refresh keeps its receipt.
- **Rate limits.** The 120 requests per user per minute cap counts manual credentials and OAuth grants together. The 30 replies per connection, per project and hour apply per grant. The owner's member reply budget is unchanged.

## 11. Account

**Account → Coding agents** becomes three parts:

1. **Connect a coding tool.** The endpoint and one tab per verified client, now without any secret or variable. For example: Claude Code, `claude mcp add --transport http uier https://uier.io/api/mcp` then `/mcp` and Authenticate, with a note to remove an `Authorization` header from an existing `.mcp.json` entry; Claude (web, desktop, mobile), Settings → Connectors → Add custom connector with the URL; Codex, the `[mcp_servers.uier]` URL block then `codex mcp login uier`; Cursor and VS Code, URL-only entries. `mcp/clients.ts` keeps generating reference-only blocks; each tab ships only after section 13's acceptance for that client.
2. **Connected apps.** One row per grant: connection name; client presentation (published host or Unverified, sends you back to); access summary ("All workspaces and projects" or "2 workspaces, 5 projects", with names on expand); operations; created, last used and expiry. **Edit access** opens the shared picker; changes apply on the next request because grants are evaluated live. **Revoke** uses an `AlertDialog` and ends access on the next request, including for an already connected client. Rows render only an allowlisted view: no client ids beyond the host, no token hashes.
3. **Access tokens.** Today's manual credential form and list, collapsed by default, labeled for environments without a browser. Expiry, the 20-credential limit, show-once secrets and revocation stay as they are.

The workspace-specific copy ("switch to the uier workspace…") is removed or reduced according to the grant decision. Grants are per user, so the section shows the same apps from every workspace, as manual credentials already do.

## 12. Security and privacy

- **Threat boundaries.** A client's name, metadata, redirect URIs and `state` are untrusted. A browser session alone authorizes nothing: approval needs a pending request, an explicit click and a current access check for every chosen workspace and project. A token is accepted only for `https://uier.io/api/mcp` and never forwarded anywhere. uier is the only issuer the MCP endpoint trusts.
- **Consent phishing.** Anyone can send a person an authorization link for a client they control. The defenses are the section 7 presentation (hosts, Unverified, loopback notice), mandatory interaction, the editable connection name and easy revocation. The consent page keeps `frame-ancestors 'none'`, so it cannot be framed or clickjacked.
- **Codes and redirects.** Exact redirect matching, short single-use codes with replay revocation, required S256 and the `iss` response parameter against mix-up attacks. Errors never redirect to an unvalidated URI. `Referrer-Policy: same-origin` keeps the consent URL out of the callback's referrer.
- **SSRF.** CIMD fetches follow section 7's network rules and limits. DCR never fetches anything.
- **Headers.** The consent and return pages use the app CSP from `proxy.ts` unchanged: nonce scripts, `form-action 'self'`, `img-src 'self'`, `no-store`. Metadata responses are public JSON with `Access-Control-Allow-Origin: *`. Token, registration and revocation responses send no CORS headers and `Cache-Control: no-store`. BotID must not cover the OAuth endpoints, because native clients cannot solve a challenge. The `/api/mcp` origin check stays.
- **Abuse.** Per-IP and per-user limits on every OAuth endpoint, bounded bodies, bounded client names, expiring DCR registrations and the per-user grant cap.
- **Data.** OAuth adds stored client metadata (names, hosts, redirect URIs), grant selections, connection names, last-use times and rate-limit counters. Feedback reaching a client is unchanged and still subject to the client's own terms. Update the privacy and security pages for the new records before production enablement. Revocation cannot retract data a client already received; say so in Account, as today.
- **Infrastructure.** No new secret or Pulumi resource: tokens are random values stored as hashes, and the issuer comes from `UIER_BASE_URL`/`appBaseUrl()`. Do not add firewall rules that block Anthropic's `160.79.104.0/21` from the metadata or token endpoints. Do not run `pulumi up` locally.

## 13. Testing

API suite, `e2e/mcpOauth.api.spec.ts` (always runs):

- Discovery: the 401 challenge on `/api/mcp`, both metadata documents parsed with the SDK schemas, `invalid_token` for expired, revoked, refresh and foreign-resource tokens, and the origin check unchanged.
- CIMD: valid document, `client_id` mismatch, missing fields, invalid redirect URIs, oversized, non-JSON, redirect responses, private-address hosts, cache reuse and the local-only test switch.
- DCR: custom schemes dropped, rejection with no valid URI, forced `none`, name normalization, registration limits.
- Authorize: no redirect for an unknown client or a mismatched redirect; error redirects with `state` and `iss`; PKCE missing or `plain`; `invalid_target`; port-agnostic loopback matching for `localhost`, `127.0.0.1` and `[::1]` but not other hosts.
- Token: wrong verifier, client or redirect; code expiry; single use; replay revoking the grant; refresh rotation; the 60-second grace and concurrent refreshes; reuse after the grace; idle and absolute expiry (seeded records, as the existing expiry tests do); revocation endpoint behavior.
- Grants: each `AgentAccess` shape with membership loss, a lost team grant, private threads, a project added later inside an "all projects" workspace, a workspace joined later under `all`, and the uier public project; `list_projects` across workspaces with its filter and bound.
- Coexistence: manual credentials unchanged; attribution names on replies and status events; idempotency across a token refresh; the shared 120-per-minute cap; the 403 `insufficient_scope` header in phase 3.

Browser suite, `e2e/mcpOauth.spec.ts`. Tag only the main journey `@smoke`: the official SDK client (`StreamableHTTPClientTransport` with an `OAuthClientProvider` over DCR, since the SDK requires an HTTPS metadata URL) starts the flow; Playwright opens the authorization URL, signs in, chooses access across two workspaces and operations, and approves; a local loopback listener receives the code; the client lists projects across both workspaces and replies; Account shows the app, and revoking it makes the next call return 401. The full suite adds the CIMD flow driven directly with the test switch, light and dark axe checks, keyboard use, the Unverified and loopback notices, cancel, the no-JavaScript return link, a mobile consent layout and Account editing.

Live acceptance per client before its setup tab ships, recorded in the PR with the deployment, client version and date, without secrets: Claude Code (CIMD, loopback, refresh after an hour, revoke and reconnect, the `.mcp.json` header removal), claude.ai and Claude Desktop custom connectors against production (hosted callback, Anthropic egress), Codex (`codex mcp login`), Cursor (DCR with its custom scheme dropped) and VS Code (CIMD). A client that fails stays off the picker and keeps manual credentials.

## 14. Documentation changes

When implemented, rewrite [docs/mcp.md](mcp.md) around OAuth setup with manual credentials as the fallback, document the endpoints, lifetimes, limits and revocation, and update `apps/web/AGENTS.md` (the MCP connector section and its client blocks, the rule against expanding grants, the OAuth route notes), `docs/development.md` for local testing (`http://localhost:4004` issuer, loopback clients), the privacy and security pages, `mcp/workflows.ts` with the generated `SKILL.md`, and the README if setup changes. Keep this plan as the design record and point it to the implemented contract, as the integration plans do.

Done with the release: [docs/mcp.md](mcp.md), `apps/web/AGENTS.md`, [docs/development.md](development.md#testing-mcp-oauth-locally), the privacy policy, the security page, `SECURITY.md`, the landing FAQ and the README. `mcp/workflows.ts` changed with the code: the access guidance now describes connections. The generated `SKILL.md` still says "credential" in two places.

## 15. Phases

1. **Authorization server and consent, previews only.** Discovery behind the deployment gate; CIMD and DCR; authorize, consent, token, refresh and revoke; `AgentAccess` storage for every option, with the consent choices the owner decides; `authenticateMcp` dispatch and `mcpProject` coverage; `list_projects` changes if B or C is chosen; Connected apps list with revoke. Exit: API and browser suites pass; Claude Code completes the flow against a preview or local origin.
2. **Production enablement and client setup.** Turn on discovery in production; rewrite the Account setup tabs and `docs/mcp.md`; privacy copy. Exit: live acceptance for every offered client; revoke tested on a live connection.
3. **Refinements.** Edit access in Account; step-up 403; the manual credential form on the shared picker (and, if decided, multi-workspace manual credentials); the workspace coding-agent policy if decided. Exit: each feature's tests and client checks.

Manual credentials ship unchanged throughout. Nothing in these phases removes them.

**Where this stands.** Phase 1 shipped together with production enablement: discovery is on in every deployment, with `UIER_MCP_OAUTH=off` as the switch to turn it off rather than a gate that starts closed. Of phase 2, only the Claude Code setup ships. Claude (web, desktop and mobile), Codex, Cursor and VS Code are not offered with OAuth until each passes the live acceptance in section 13; they keep manual access tokens. Phase 3 has not started.

## 16. Decisions

Taken on 2026-10-29. Every recommendation was adopted.

1. **Grant model.** Store `AgentAccess`. Consent offers "All my workspaces and projects, including new ones" (selected by default) and "Choose workspaces and projects" (each workspace either all projects including new ones, or chosen projects). Not taken: A only (today's model, multiple server entries); B without C.
2. **Default operations at consent.** Only the requested scopes are preselected (the challenge requests read), with "Select all operations". Not taken: all five preselected.
3. **Operations per grant or per workspace.** Per grant, with the consent warning about writes across workspaces and guest projects. Per-workspace operations are not offered.
4. **Lifetimes.** Access tokens 1 hour; refresh tokens rotate, with a 30-day idle expiry and a 60-second grace; grants end after 1 year. Not taken: no absolute limit.
5. **Dynamic client registration.** Supported, with the restrictions in section 7. Not taken: CIMD only.
6. **Custom URL schemes.** Dropped at registration and never accepted at authorization.
7. **Workspace control.** No workspace admin control in this release. Designing it is phase 3, because option C reaches client workspaces automatically.
8. **Manual credentials.** Kept for headless use. Moving their form to the shared picker, with multi-workspace access, is phase 3.
9. **Reconnect consent.** Consent is always shown, also for a known client.
10. **Missing `resource`.** Defaults to the MCP endpoint, the only protected resource; any other value is rejected with `invalid_target`.

## 17. Decision log

- uier is its own authorization server on the app origin; no external identity provider, OpenID Connect, Express or OAuth framework. The SDK supplies schemas and the test client.
- The protected resource is exactly `https://uier.io/api/mcp`; audience is checked by exact comparison, not by `checkResourceAllowed`.
- Opaque, hashed, user-partitioned tokens in the existing `app` container; grants are evaluated live on every request, and deleting a grant revokes it.
- Public clients with S256 PKCE only; refresh tokens rotate with a 60-second grace and reuse detection.
- CIMD first, DCR for compatibility; client names are never treated as verified; loopback and HTTPS redirects only, with port-agnostic loopback matching.
- The consent page is a uier `/app` page built with shadcn components, reached through a stored request id, and returns through a same-origin page because of `form-action 'self'`.
- Attribution and idempotency are keyed by the grant, not the access token.
- Discovery is advertised only where the whole flow works; manual credentials remain supported. Superseded on 2026-10-29: production enablement shipped with phase 1, and discovery is on everywhere unless `UIER_MCP_OAUTH=off`.
- 2026-10-29: the ten decisions in section 16, as recommended.
- 2026-10-29: Claude Code is the first and only client offered with OAuth: `claude mcp add --transport http uier https://uier.io/api/mcp`, then `/mcp` → Authenticate. An `Authorization` header in the entry turns Claude Code's OAuth off, so the setup says to remove it. Other clients keep manual access tokens until their live acceptance passes.
- 2026-10-29: **Account → Coding agents** lists **Connected apps** with Revoke, and keeps manual credentials under **Access tokens** for environments without a browser.
- 2026-10-29: the discovery documents are served through `next.config.ts` rewrites, not route folders under `app/.well-known/`.

## 18. Implementation notes

Where the code in `apps/web/src/lib/mcp/oauth/` and `apps/web/app/api/oauth/` differs from the sections above. [Coding tool access (MCP)](mcp.md) documents the behavior as built.

- **Discovery routes.** `next.config.ts` rewrites `/.well-known/oauth-protected-resource/api/mcp` to `/api/oauth/metadata/protected-resource` and `/.well-known/oauth-authorization-server` to `/api/oauth/metadata/authorization-server` (section 6 left this open).
- **Switch instead of gate (section 6).** `mcpOauthEnabled()` is true unless `UIER_MCP_OAUTH=off`. Off makes the metadata documents and every `/api/oauth/*` route answer 404 and restores the plain `Bearer realm="uier MCP"` challenge. `/api/mcp` also rejects OAuth access tokens already issued.
- **Files (section 2).** The modules are `oauth/{config,metadata,clients,redirects,authorize,tokens,grants,http,errors}.ts`. CIMD and DCR live in `clients.ts`; the stored request, approval and cancellation for the consent page live in `authorize.ts`. There is no `cimd.ts`, `registration.ts` or `consent.ts`. The scope list moved to `mcp/scopes.ts`.
- **Client metadata (section 7).** CIMD documents and registrations are validated with a local zod schema of the fields uier reads (`client_id`, `client_name`, `redirect_uris`, `token_endpoint_auth_method`, `grant_types`, `response_types`), not with the SDK's `OAuthClientMetadataSchema`. A CIMD document fails as a whole when any redirect URI is unacceptable or there are more than ten; DCR drops unacceptable URIs as planned.
- **CIMD fetch limits (section 7).** At most 60 fetches per metadata host and hour, plus the authorize endpoint's per-IP limit and the five-minute failure cache. The 5-second limit is a total deadline, not only an idle timeout.
- **DCR lifetime and limits (section 7).** A registration expires 30 days after the last authorization request that used it (refreshed at most once a day), also while a grant uses it. Existing grants keep working, because token exchange, refresh and `/api/mcp` never read the client record; a new sign-in with that `client_id` fails and the client registers again. Registration is limited to 20 per IP and 2000 in total per hour. A requested client authentication method is replaced with `none`.
- **Endpoint limits (section 9).** Per IP and hour: authorize 60, token 3000 (raised from 600 because hosted clients such as claude.ai share egress addresses), revocation 120, registration 20. Per subject and hour: 30 approvals per account, 120 refreshes per grant, 60 metadata fetches per host. There is no separate failed-token limit: codes and tokens are 256-bit random values, and a limit counted after failures would never block a later request. Local loopback requests are not limited by IP.
- **Authorization request (section 8).** Repeated parameters are rejected with `invalid_request`, and `state` is limited to 1024 characters. Unknown clients and redirect URIs go to `/app/connect/error?error=<code>`, a page that works signed out. The 303 to consent sends `Referrer-Policy: no-referrer`.
- **Token errors (section 9).** A code or refresh token presented by another client gets `invalid_grant`; the token endpoint never answers `invalid_client`.
- **Refresh reuse (section 9).** A rotated refresh token is kept for 24 hours. Reuse between 60 seconds and 24 hours after rotation revokes the grant; after that the record has expired and reuse only gets `invalid_grant`.
- **Idle expiry.** The 30 days run from the last refresh. The hourly last-use update on `/api/mcp` does not extend them; an active client refreshes every hour anyway.
- **Revocation (section 9).** `client_id` is optional at `/api/oauth/revoke` and must match when sent. Revoking a grant (by refresh token, from Account, or on code replay or refresh reuse) deletes only the grant document; the best-effort delete of its token documents by `grantId` is not implemented. Access ends at once because every access token and refresh is checked against its grant: it must exist, be within its idle and absolute expiry and belong to the same client. The token documents expire by TTL (access tokens after 1 hour and 5 minutes, refresh tokens after at most 31 days).
- **`authInfo` (section 10).** Not passed to `transport.handleRequest`. Tools receive the identity through `createFeedbackMcpServer` only.
- **`list_projects` (section 4).** It requires `feedback:read` like every read tool, and a refresh cannot narrow a token below `feedback:read`.
- **Access guidance.** Editing a connection's access is phase 3, so `feedbackAccessGuidance` and the `list_projects` description tell agents to ask the person to reconnect and choose the project, or to create an access token that includes it.
