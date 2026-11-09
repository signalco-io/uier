# AI agents under the assignee

`DbComment.assigneeAgent` is the one AI agent working on a thread under its assignee: kind (`@uier/toolbar/agents`:
Claude, Codex, ChatGPT, Cursor, AI agent), the `assigneeId` it belongs to, optional session id, model and reasoning level (untrusted
one-line text; the reasoning level is free text up to 32 characters, `MAX_AGENT_REASONING_LENGTH`, because providers name levels differently), who set it and when, and the MCP connector that attached it. Read it only through
`currentAssigneeAgent` / `assigneeAgentView` (`review/assigneeAgentModel.ts`, pure): an agent saved under an earlier
assignee is never shown. `setAt` is when the agent started: new details for the same kind and session id keep it,
another kind or session restarts it. `setProjectCommentAgent` (`review/assigneeAgent.ts`) is the one write, through `changeComment`
and atomic receipts: only the current assignee sets or clears it for themselves (the app's `setCommentAgentAction`, or
their own MCP connection); other members and admins get `forbidden`, guests too. `assignToMe` (MCP only, on the
person's explicit request) assigns an unassigned thread to the actor in the same write; never reassign someone else's
thread. `startWork` (MCP only, when the connection also has `feedback:status`) moves an Open thread to In progress
in the same write when an agent is attached (none was current): its own activity step and a `progress-started` event
after the `agent` one, emailed to followers like any status change. Updates, clears and other stages never move; the
app's `AgentControl` does not pass it (the assignee sets the status in the same panel). `setProjectCommentAssignee` removes the agent with every assignee change (with an `agent` event naming the
previous assignee) and `setProjectCommentPrivate` with an assignee who loses the thread. Each change advances activity
and records an `agent` notification event (MCP `feedback.agent_changed`), which `eligibleEvents` never emails. Members
get the agent in views, the review DTO (toolbar), `list_feedback` and packets; guests never. Integration delivery
strips `context.assignee.agent` before formatting. The UI is `AgentMark` (each agent's one-colour product logo from `agentMarks`:
Claude, the OpenAI logo for Codex and ChatGPT, Cursor, a generic bot for AI agent), `AgentAvatar` / `AssigneeAvatars` (the mark on a bordered
circle, stacked on the assignee's avatar: rows, board cards, the agent menu), `AssigneeCard` (those avatars on rows,
board cards and My work as a hover popover, `hoverPopoverTrigger` with a 200 ms delay: the assignee, "You" for the
signed-in assignee, and the agent with its model by name, reasoning level, when it started and its session; a mouse
click still opens the thread, the keyboard and a tap open the card; the trigger is named by `assignedLabel`; a value cut
off with an ellipsis, such as a long session id, shows in full in a tooltip on hover and on keyboard focus: `CutText`
measures it, and only a cut-off line joins the Tab order; opened by the keyboard, focus starts on the card itself) and `AgentControl` (the logo beside the
agent's name in the thread's Assignee field with the model and reasoning level, the assignee's menu, Session and model dialog).
Views show the model by name: `modelName` (`@uier/toolbar/agents`, pure) turns known ids into their makers' names
(Claude current, dated, older and routed ids; OpenAI GPT, Codex and o-series; Gemini; Grok, DeepSeek, Mistral, Qwen,
Kimi, Llama, GLM, Cursor's Composer) and returns undefined for any other id, which shows as reported in mono.
`agentModelText` drops the agent's own name ("Opus 5.5" after Claude; Cursor keeps "Claude Sonnet 4.5"), and
`agentText` is the one-line name of avatars and the toolbar header ("Claude Opus 5.5 (xhigh reasoning)"). The thread
shows the level alone after a dot ("· xhigh", titled and read as "xhigh reasoning") and the reported id as the model's
title; the Session and model dialog, packets and Markdown keep the raw values. Add a family to `modelName` and a case to
`agent-models.api.spec.ts` together. The MCP tools are `set_feedback_agent` / `clear_feedback_agent` under
`feedback:assign`. Tests: `assignee-agent{,.api}.spec.ts` (the card: hover, keyboard, a cut-off session id's tooltip, a click opening
the thread, a tap on a phone), `agent-models.api.spec.ts`.

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
`working` and the attached `sessionId` when present. Only the current assignee's attached MCP connection
and exact session can start, renew or clear it; another connection or stale session gets `conflict`.
The server sets `assigneeAgent.workingUntil` five minutes ahead; renew every two minutes with a fresh
idempotency key. Atomic receipt retries do not extend it or overwrite a later clear. `working: false`
removes only the lease. Detaching, changing kind/session/connection or changing assignee ends it;
metadata edits in the same session keep it. Older attachments have no lease.

`assigneeAgentView` includes `workingUntil` only while live, for members in app/toolbar/MCP lists.
These ephemeral writes use the usual conditional write and etag realtime detection, without changing
status, unread activity, notification events, content timestamps/revisions, integration signals or AI titles.
Heartbeats are not durable agent events: no activity history, email or `feedback.agent_changed` spam.
`useAgentWorking` (`@uier/toolbar/agent-working`) expires mounted indicators locally with one cleanup-safe
timer and no extra reads, even offline. `AgentAvatar`, `AssigneeCard`, the thread's `AgentControl` and
the toolbar's `CommentAssignment` show the small spinner and accessible working text; reduced motion
keeps the indicator still. Coverage includes lease expiry/retry/ownership, realtime updates and draft preservation, and indicators
on list, board, My work, thread, hover card and toolbar.
