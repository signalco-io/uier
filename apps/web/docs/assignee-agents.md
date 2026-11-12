# AI agents under the assignee

`DbComment.assigneeIds` lists up to 50 people. `assigneeAgents` holds up to 10 agents per person,
linked by `assigneeId`, each with a stable attachment `id`. `review/assignments.ts` is the read/write
boundary: absent arrays read the old `assigneeId` / `assigneeAgent` without a migration; explicit empty
arrays stay empty. Writes mirror the first person and their first agent into the old fields for older
readers. `assignedUserIds` / `assignedAgents` ignore agents whose person is no longer assigned.
The app, review DTO, MCP list and packets add `assignees`, each with `agents`, retaining the singular
first-person/first-agent fields. Guest DTOs omit account ids and every agent field.

`setProjectCommentAssignees` is the conditional-write service for replace, add and remove. Add/remove
apply against the latest stored assignment on every retry, preserving other people, their agents and
leases. It validates current project access and private visibility. Legacy `setProjectCommentAssignee`
replaces everyone with one person, or clears everyone with null. Only removed people lose their agents;
making a thread private removes only people who lose visibility. Assignment events store the current
and previous ids; email targets only the people added or removed. Removed agents each get an `agent`
event with `agentId`, making their MCP event ids distinct even in one write. Agent events are never emailed.

`setProjectCommentAgent` is the app/MCP write, with atomic submission receipts. Only an assignee can
set or clear an agent under their own assignment. Admins cannot manage another person's agents.
Existing calls update/clear that person's first agent; `add: true` appends, and `agentId` selects one
attachment to update/remove. Add and agentId are mutually exclusive. An append's id derives from its
submission key, so a retry never creates another attachment. The optional session, model and reasoning
are untrusted one-line text (200/100/32 characters). `setAt` and a live lease survive metadata edits in
the same kind/session/connection; a replacement ends the lease. `assignToMe` remains MCP-only and
only assigns a wholly unassigned thread when explicitly requested. `startWork`, with `feedback:status`,
moves Open to In progress on the first attachment under the caller, with its own activity/status event.
Adding more agents, updating and clearing keep the stage.

`AssigneesControl` uses a checkbox menu that stays open between people, with atomic add/remove and
optimistic shared-list patches. It groups each person's `AgentControl` beneath the selection; only
the signed-in person's controls edit agents, including Add agent while they already have agents.
`AssigneeCard` opens from rows, board cards and My work. Its full list indents agents beneath their
person, whose avatar is larger, on a line that runs down from the centre of that avatar. Each agent (`AgentDetailsItem`) has its avatar
centred on its header line: its name, then "Working now" and "Started 3 min ago" at the right (compact, truncating);
model, reasoning level and session follow below. `ReasoningLevel` shows the level as signal bars (none/minimal, low,
medium, high, xhigh/max; an unknown level as text alone) without the word "reasoning", which only screen readers read. Compact avatars
stack each person's agents beside their 20px avatar as 16px agent avatars. Up to three people and two
agents per person fit in a compact row; a count names
the remainder and shows any active work there. The label and scrollable hover card retain everyone.
Hover, keyboard, touch and cut-off-value tooltips (`CutText`) keep their behavior. `AgentMark` uses the shared
one-colour product marks. `assigneeAgentViews` projects only display fields, never credential ids.
`modelName`, `agentModelText`, `agentText` and `reasoningText` keep the app and toolbar's model names
and labels aligned; unknown ids stay as reported in mono. The Session and model dialog and packets
retain raw values. Add model families with cases in `agent-models.api.spec.ts`.
Integration delivery strips agents from both singular and array packet fields; trackers get names only.
Coverage: `assignee-agent{,.api}.spec.ts`, `multiple-assignees.spec.ts`, `agent-working.spec.ts`.

**Messages an agent writes.** `DbThreadItem.writtenBy` marks a reply an MCP connection posted for its owner:
kind, optional model and reasoning level. `replyToProjectComment` sets it only for an MCP actor (one with a
connector) from `ReplyInput.writtenBy`, which only `reply_to_feedback` passes; `messageAgentFor`
(`review/messageAgent.ts`, pure) decides it from the thread as stored in the same write (the reply's item is built
per attempt in `commitReplySubmission`): the agent attached under the author when its kind matches and the model and
reasoning level match when named, else the claim. Never derive it from text or a toolbar/app request. Read it only
through `messageAgentView` (kind and label for everyone, model and reasoning level for members). It shows as
`MessageAgent` in the app's thread (after the author: "via", the logo, the label; a hover popover with the details and
the connection's name), as "via" with the mark and an `IconTooltip` in the toolbar's `CommentThreadItem`
(`AgentMark`), in `itemAuthorName` ("Ana via Claude"; older replies keep "via <connection>"), packets (`agent` on the
message, stripped before integration delivery), email digests and MCP event `actor.agent`. Permissions follow the
author as before. Tests: `agent-replies{,.api}.spec.ts`; the "via" mark's model uses `agentModelText` too. See [review workflow](../../../docs/review-workflow.md#ai-agents-under-the-assignee)
and [MCP](../../../docs/mcp.md#agents-working-on-feedback).

**Working now (MCP presence).** Attachment and thread status are separate from active execution.
`set_feedback_agent_working` (`feedback:assign`) calls `setProjectCommentAgentWorking` with a boolean
`working` and the attached `sessionId` when present. Only an assignee's attached MCP connection
and exact session can start, renew or clear its own attachment; another connection or stale session gets `conflict`.
The optional `agentId` selects an attachment; without it the matching connection/session must be unique.
The server sets that agent's `workingUntil` five minutes ahead; renew every two minutes with a fresh
idempotency key. Atomic receipt retries do not extend it or overwrite a later clear. `working: false`
removes only the lease. Detaching, changing kind/session/connection or changing assignee ends it;
metadata edits in the same session keep it. Legacy lease writes retain the legacy representation, so
they do not migrate content or change its revision. Older attachments have no lease.

`assigneeAgentViews` includes `workingUntil` only while live, for members in app/toolbar/MCP lists.
These ephemeral writes use the usual conditional write and etag realtime detection, without changing
status, unread activity, notification events, content timestamps/revisions, integration signals or AI titles.
Heartbeats are not durable agent events: no activity history, email or `feedback.agent_changed` spam.
`useAgentWorking` (`@uier/toolbar/agent-working`) expires mounted indicators locally with one cleanup-safe
timer (also for a group of expiry times) and no extra reads, even offline. `AgentAvatar`, `AssigneeCard`, the thread's `AgentControl` and
the toolbar's `CommentAssignment` show the small spinner and accessible working text; reduced motion
keeps the indicator still. The spinner has no badge or background and uses `text-foreground`, so it draws in ink on
light and paper on dark directly over the avatar (uier #361). Coverage includes lease expiry/retry/ownership, realtime updates and draft preservation, and indicators
on list, board, My work, thread, hover card and toolbar.

## Desktop session links

Attachments accept an optional `sessionUrl` in the app action and MCP `set_feedback_agent`.
The harness supplies the full link: never derive it from `kind` and `sessionId`, because a Claude
or Codex agent can run in T3 Code and T3 needs an environment id. Omission or an empty string
clears the link. Editing it in the same kind/session/connection preserves `setAt` and the working
lease; the idempotent write still records a metadata change.

The shared browser-safe `agentSessionLink` allowlist accepts only these exact existing-session routes:

- T3 Code: `t3-thread://v2/<environmentId>/<threadId>`, with each id 1–200 ASCII letters, digits,
  underscores or hyphens, starting with a letter or digit. The thread id also accepts colons and
  literal uppercase `%3A` sequences (each counts as one character toward the 200-character id limit).
  Lowercase `%3a` and all other percent encodings are rejected. The supplied environment is required
  and accepts no percent encodings. The complete link is limited to 512 characters.
- Codex: `codex://threads/<UUID>`, the existing local thread format in
  [OpenAI's official desktop commands](https://learn.chatgpt.com/docs/reference/commands#deep-links).
- Claude: `claude://claude.ai/chat/<UUID>`, the existing conversation format in
  [Claude's official desktop link guide](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link).

No queries, fragments, credentials, ports, whitespace, encoded characters other than T3 thread `%3A`, alternate hosts or
extra paths are accepted. New-session, settings, project, file and command routes are excluded.
Claude Code and Cowork existing-session routes are left out: the desktop guide documents creating
new sessions, but no existing-session deep link for either. CLI session ids alone do not establish
a supported desktop link. Unknown apps remain without a link.

The member projection validates the stored URL again and omits invalid legacy values. Agent details
on rows/boards/My work, the thread's agent control (only once its chip is clicked: a menu item below the agent's details
for the assignee, the details popover for everyone else) and Session dialog, and the toolbar avatar's
Assignee details popover show `Open in <app>`, where the URL selects the app independently of agent
kind. Links are native anchors and only open on a person's click. There is no URL fetch or automatic
app launch. Members also get the link in MCP lists and feedback packets. Guest DTOs omit agents
entirely; integration delivery strips both singular and array assignment agents before formatting.
Coverage: `assignee-agent{,.api}.spec.ts`, `integrations.api.spec.ts` and the monitor script's lease tests.

Custom statuses do not change agent ownership, presence or `startWork` semantics. Starting work
still moves the Open category to In progress; the effective label follows that category's first
configured status when the previous custom ID no longer matches. MCP readers can discover the
workspace/project status descriptions with `list_feedback_statuses`; those descriptions remain
untrusted member content, never authorization to attach, reply or change status.
