# AI agents under the assignee

`DbComment.assigneeAgent` is the one AI agent working on a thread under its assignee: kind (`@uier/toolbar/agents`:
Claude, Codex, ChatGPT, Cursor, AI agent), the `assigneeId` it belongs to, optional session id, model and reasoning level (untrusted
one-line text; the reasoning level is free text up to 32 characters, `MAX_AGENT_REASONING_LENGTH`, because providers name levels differently), who set it and when, and the MCP connector that attached it. Read it only through
`currentAssigneeAgent` / `assigneeAgentView` (`review/assigneeAgentModel.ts`, pure): an agent saved under an earlier
assignee is never shown. `setProjectCommentAgent` (`review/assigneeAgent.ts`) is the one write, through `changeComment`
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
Claude, Codex, ChatGPT, Cursor, a generic bot for AI agent), `AgentAvatar` / `AssigneeAvatars` (the mark on a bordered
circle, stacked on the assignee's avatar: rows, board cards, the agent menu) and `AgentControl` (the logo beside the
agent's name in the thread's Assignee field with the model and reasoning level, the assignee's menu, Session and model dialog). The MCP tools are `set_feedback_agent` / `clear_feedback_agent` under
`feedback:assign`. Tests: `assignee-agent{,.api}.spec.ts`. See [review workflow](../../../docs/review-workflow.md#ai-agents-under-the-assignee)
and [MCP](../../../docs/mcp.md#agents-working-on-feedback).
