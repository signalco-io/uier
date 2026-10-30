# Azure DevOps Boards integration

Status: adapter, project settings and local simulator tests implemented. Microsoft Entra app
registration, production credentials and hosted acceptance in a real Azure DevOps organization
remain manual release gates. [The shared contract](integrations.md), [setup](integration-setup.md)
and [operations](integration-operations.md) describe the delivery core this adapter plugs into.

## 1. Goal and scope

A uier workspace admin connects a project to one Azure DevOps organization and project, then chooses
a work item type, the states for open and done feedback and an optional area path. After the admin
saves the destination, each eligible uier thread becomes one Azure Boards work item. uier is the
source of truth; Azure DevOps is a one-way copy.

New and changed non-private threads sync automatically; an explicit backfill sends at most the
newest 1,000 shared threads. All feedback kinds are eligible.

Non-goals: inbound edits, service hooks, comments in the work item's Discussion, Azure DevOps
assignment, tags, iteration paths, priority or severity inference, creation of projects, types,
states or areas, screenshot uploads, Azure DevOps Server, personal access tokens and personal
Microsoft accounts.

## 2. Azure DevOps facts the design depends on

- Azure DevOps OAuth apps are deprecated: new registrations stopped in April 2025 and the service is
  scheduled for full deprecation in 2026. New apps use Microsoft Entra ID OAuth with delegated
  permissions for the Azure DevOps resource `499b84ac-1321-427f-aa17-267ca6975798`.
  [OAuth overview](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/oauth),
  [Entra OAuth](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/entra-oauth).
- Entra apps do not support Microsoft account (MSA) users for the Azure DevOps resource, so the
  authority is `organizations` (or one configured tenant id), never `common`.
- `vso.work_write` reads, creates and updates work items, runs queries and reads area paths;
  `vso.profile` reads the profile, the organizations (accounts) and projects. Neither is marked high
  privilege. `offline_access` adds the refresh token.
- There is no service actor for delegated OAuth: every write is made as the signed-in user, and
  Azure DevOps permissions are that user's project permissions.
- Work item creates accept no client-chosen identifier. Recovering from a lost create response
  therefore needs a query (WIQL), which reads the work item store directly.
- Deleting a work item moves it to the project's recycle bin; it is not destroyed, and earlier field
  values stay in its revision history.
- Throttling answers HTTP 429 with `Retry-After`. A rejected credential can answer 401 or a 203
  sign-in page.

Validate these against a dedicated test organization before customer rollout (section 10).

## 3. Records

| Document | Partition / identity | Contents |
| --- | --- | --- |
| `azure-devops-connection` | `workspace:<id>` / `azure_devops_<projectId>_<uuid>` | Common connection envelope; destination (`organization`, `organizationId`, `projectId`, `projectName`, `workItemType`, `bodyField`, `openState`, `doneState`, optional `areaPath`) |
| `azure-devops-grant` | `workspace:<id>` / `azure_devops_grant_<hash(connectionId)>` | One connection's encrypted access and refresh tokens, expiry, scopes, Azure DevOps profile id and display name, generation, refresh lease, rate-limit pause |
| `azure-devops-selection` | `workspace:<id>` / `azure_devops_selection_<projectId>` | Finds the connection before a destination is saved and bound |
| `azure-devops-oauth-state` | `user:<id>` | Shared single-use OAuth state with an encrypted PKCE verifier |
| `azure-devops-sync` | `azure-devops:<projectId>` | Common ledger; state holds the current copy and up to 20 retired copies: organization, project, type, body field, work item id, marker, body hash, last status sent, create start time and cleanup flags |

A grant belongs to exactly one connection, unlike Linear's shared organization grant: delegated user
tokens have no installation to share, and a per-project grant keeps disconnect simple. Ledgers hold
identifiers and hashes, never feedback text, HTML or tokens. Settings render an allowlisted view
(`view.ts`): names and states only, plus the connected account's display name.

## 4. Connect and disconnect

`/app/azure-devops/connect` and `/app/azure-devops/callback` use the shared route helpers: current
admin, same-origin navigation, no prefetch, no return URL from the browser. The authorize request
uses S256 PKCE, `response_mode=query`, `prompt=select_account` and scopes
`<resource>/vso.work_write <resource>/vso.profile offline_access`.

The callback consumes the state once, rechecks the admin, exchanges the code, requires both scopes
in the token response and reads the Azure DevOps profile. It stores a disabled connection without
a destination: authorization alone sends nothing.

Reconnecting keeps the connection, destination and ledgers and replaces the grant under a
generation increment. If a different Microsoft user reconnects, sync turns off until an admin saves
the destination again, because that user may not reach it.

Disconnect removes the binding, suppresses the project's ledgers and wipes the local tokens. The
Microsoft identity platform offers no per-grant revocation for this flow; people remove uier from
their Microsoft account's apps, or a tenant admin removes the enterprise application. Removing or
demoting the connecting admin marks the connection `member_left` and wipes its grant.

## 5. Choosing the destination

Each step is an explicit admin action, never part of rendering settings:

1. Organizations: `GET app.vssps.visualstudio.com/_apis/accounts?memberId=<profile id>`.
2. Projects: `GET dev.azure.com/<org>/_apis/projects` (well-formed only, paged by continuation token).
3. Project options: work item types with their states and state categories, the hidden type category
   (removed from the choices: test, review and feedback request types are not on boards) and the
   area path tree (depth 10).

Lists are capped at 500 entries and say so when truncated. Open states must be in the Proposed or
In Progress category, done states in Resolved or Completed, and they must differ. Saving rechecks
every choice live with the connected user's access, then reads the type's fields: Bugs get the text
in Repro Steps, which their form shows; other types use Description. A type with neither is refused.

Changing the organization, project or type starts new work item identities. Earlier work items stay
where they are and keep their own destination for cleanup. A new area path applies to new work items.

## 6. Sync semantics

| Source change | Azure DevOps operation |
| --- | --- |
| New thread or backfill | Record the create start time, then create the work item with title, text field and optional area path |
| Edited feedback, new or edited reply, context change | Replace the title and text field when the projection hash changes |
| Resolve or reopen | Set the mapped state, only when the uier status changes and the item is not already in that state |
| Made private or hard deleted | Replace title and text with a removal notice, then delete the work item to the recycle bin |
| Visible again | A fresh work item; the removed one stays a retired cleanup record |
| Work item missing or moved to another project or type | The ledger needs review; uier never recreates or takes it back |

The text field is escaped HTML built from the shared feedback context: feedback, page and anchor,
browser context, a protected screenshot link and the uier discussion. Every saved value is text, so
markup, mentions and work item links in feedback stay literal. Threads over 30,000 characters get a
shortened copy with a link to uier (`content_truncated`). Comments in the work item's Discussion would
appear to be written by the connecting admin, so the uier discussion stays in the text field.

The state follows uier's status changes only, so a team can move the item on its board without uier
moving it back. Title and text belong to uier and are replaced on the next change.

Each copy carries a marker `uier-source:<hash>` in its text field. After a create whose response is
lost, a WIQL query lists the work items of that type created between five minutes before and fifteen
minutes after the attempt, and a batch read checks their text for the marker. One match is adopted;
several are `duplicate_work_items`; more than 1,000 candidates is `reconciliation_limit`. An empty
result waits until two minutes after the create started before the create is sent again. A renamed
project is matched by its id.

## 7. Delivery worker

The adapter runs in the scheduled worker with at most four minutes and 100 calls per turn. Requests
are paced to one at a time per grant with 250 ms spacing, a 20-second timeout and `api-version=7.1`.

| Answer | Result |
| --- | --- |
| 429 | Wait without a failure; the grant pauses until `Retry-After` |
| 401 or 203 | One forced refresh under the grant lease, then wait; `invalid_grant`, `interaction_required` and `consent_required` need a reconnect |
| 403 or 404 on the destination | Pause the connection (`destination_unavailable`) |
| 400 | Pause the connection (`work_item_rejected`): a required field or rule in the process refused the change |
| Timeout or 5xx after a create | Keep the attempt and reconcile before any resend |
| Missing work item during cleanup before it was scrubbed | `cleanup_incomplete`: missing and inaccessible look the same |

Turning sync on again resumes a paused connection.

## 8. Configuration

```text
AZURE_DEVOPS_CLIENT_ID       Entra application (client) id
AZURE_DEVOPS_CLIENT_SECRET   Entra client secret
AZURE_DEVOPS_TOKEN_KEY       generated by Pulumi; AES-256-GCM key for grants and PKCE verifiers
AZURE_DEVOPS_TENANT          optional; `organizations` (default) or one tenant id
```

Endpoint overrides (`AZURE_DEVOPS_API_BASE_URL`, `AZURE_DEVOPS_PROFILE_BASE_URL`,
`AZURE_DEVOPS_OAUTH_AUTHORIZE_URL`, `AZURE_DEVOPS_OAUTH_TOKEN_URL`) work only in the local runtime and
only for loopback hosts. Previews are never configured.

## 9. Security and privacy

Private threads are never exported; cleanup runs without a feedback packet. The connecting admin's
Microsoft account is visible as the creator and editor of every work item, and anyone with access to
the Azure DevOps project can read them. Work item history, notifications, the recycle bin and
analytics can keep earlier text after cleanup. Screenshots stay in uier behind protected links.
Tokens are encrypted with a provider, workspace, project and connection bound context and never
appear in views, errors or logs.

## 10. Testing and release gates

`azure-devops.api.spec.ts` runs the adapter against `e2e/support/azureDevOpsStub.ts`, a loopback
stand-in for Entra and the REST subset: PKCE and scopes, state replay, missing scopes, denial,
destination validation, body field choice, create and update, board state preservation, lost and
unanswered creates, privacy cleanup and recreation, deletion across destinations, a deleted work
item, project rename, a rejected change, rate limits, token refresh, removed admins, disconnect,
member-only links and HTML escaping. `azure-devops.spec.ts` covers the settings flow, admin-only
controls, backfill, disconnect and accessibility in the browser.

Before customer rollout, in a dedicated organization:

- Register the Entra app and grant consent as a regular user and through a tenant admin.
- Confirm the token response's scope format, refresh token rotation and lifetime.
- Create, update, change state and delete with a Contributor; confirm that deleting needs no more
  than `vso.work_write` and the default Contributor permissions, and that 403 is reported as blocked.
- Check that a work item created in an inherited process accepts the mapped open and done states,
  and that a process with an extra required field reports `work_item_rejected`.
- Lose a create response on purpose and confirm the WIQL reconciliation adopts it.
- Confirm the rendering of the text field (headings, `pre`, links) on the Bug and Task forms.
