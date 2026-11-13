# uier monitor state reference

`state.json` fields the watcher and `M status` read (add your own freely, but prefer these):

```json
{
  "project": { "id": "uier00000001", "name": "uier.io public feedback", "workspace": { "id": "…", "name": "uier" }, "site": "https://uier.io" },
  "repo": { "slug": "signalco-io/uier", "root": "<a checkout of the repository>", "base": "main" },
  "me": { "id": "u_…", "name": "…", "also": [{ "id": "u_…", "name": "…" }], "reviewer": null },
  "scope": "mine",
  "max": 6,
  "harness": { "kind": "t3", "prWatch": true, "threadId": "…", "pinnedAt": "2026-11-13T09:30:00Z", "fable": ["claudeAgent"], "routing": { "ui": { "provider": "…", "model": "…" } } },
  "workflow": { "mode": "pr", "base": "main", "method": "squash", "autoMerge": true, "strict": false, "mergeQueue": false,
    "requiredChecks": ["CI OK"], "rerun": "all", "knownFlaky": ["launch.spec.ts:67"],
    "deploy": { "kind": "actions", "workflow": "deploy.yml", "branch": "main", "pathsIgnore": ["*.md"] }, "detectedAt": "…" },
  "watch": { "wakes": 0, "wakeAt": null, "mcpCursor": null, "lease": "available", "writes": "available", "writer": "mcp", "maxMinutes": 110, "fallbackMinutes": 15, "reconcileMinutes": 15 },
  "limits": { "claudeAgent": { "until": "2026-11-12T17:00:00Z" } },
  "items": { "<commentId>": { "number": 61, "link": "…", "priority": "normal", "decision": "accepted", "reason": "…",
    "size": "S", "class": "ui", "areas": ["board"], "verify": false, "group": "g61", "stage": "in-progress", "round": 1 } },
  "groups": { "g61": { "items": ["<commentId>"], "state": "building", "size": "S", "class": "ui", "areas": ["board"],
    "provider": "…", "model": "…", "effort": "medium", "taskId": "…", "threadId": "…", "threads": ["…"], "branch": "…", "port": 4104, "pr": 456, "head": "…",
    "startedAt": "…",
    "agentLease": { "items": ["<commentId>"], "agent": "claude", "model": "claude-opus-5-5", "reasoning": "medium", "sessionId": "<thread id>", "sessionUrl": "t3-thread://v2/<environmentId>/<threadId>", "state": "working", "clear": [] },
    "closing": { "agent": "claude", "model": "claude-opus-5-5", "reasoning": "medium",
      "items": { "<commentId>": { "reply": "Fixed in [`{sha7}`]({commitUrl}) ([PR #456](…)), deployed to uier.io. …" } } } } },
  "prs": { "456": { "group": "g61", "state": "open", "head": "…", "autoMerge": true } },
  "deploys": { "pending": [{ "pr": 456, "sha": "…", "groups": ["g61"] }] },
  "mainFailures": { "triage.spec.ts:118": { "first": "…", "count": 2, "prs": [676, 680] } }
}
```

- `harness.pinnedAt`: UTC timestamp of the last successful T3 orchestrator thread pin. Refresh on
  start, resume or tick, or when a wake reports the thread settled; clear on stop. It records the
  last pin, not a live thread-state check.
- `items.*.decision`: `accepted`, `asked`, `rejected`, `done-already`, `duplicate` or `skipped`.
- `items.*.stage`: the uier stage you expect (`open`, `in-progress`, `ready`, `done`). The watcher
  reports a person's change as `drift`; it records its own Open to In progress change itself.
- `items.*.writePending`: uier writes that failed through both connections, retried on every wake.
- `watch.writes`: whether the watcher's token can change status and reply (`available`, `missing`).
  The watcher closes comments after deploys only when it is `available`.
  `watch.writer`: which connection writes about comments (`mcp` or `watcher`).
- `workflow.strict`: whether PRs must be up to date before merging. With `false` the watcher records
  merges quietly and nothing waits in line.
- `limits.<provider instance>.until`: a usage limit; route new sessions to the other provider until then.
- `groups.*.state`: `queued`, `held`, `building`, `pr`, `fixing`, `reviewing`, `merged`, `closed`,
  `blocked` or `cancelled`. `building`, `fixing` and `reviewing` hold a slot.
- `groups.*.threads`: every session thread of the group (fix, review, follow-up, rebase), archived
  when the group closes.
- `groups.*.agentLease.state`: `working` while its session runs, then `done`. The watcher keeps its
  progress per comment (attached details, last renewal) in `watch.json`; a lease removed from the
  state counts as done. `clear` lists comments whose agent the watcher removes when it ends.
- `groups.*.closing`: the replies drafted when the PR was approved (`SKILL.md`, Closing in uier). Per
  item: `reply` (may use `{sha}`, `{sha7}`, `{commitUrl}`), optional `status: "keep"` (reply only) or
  `verify: { reviewerId, expectedRevision, fixUrl, summary }`. The watcher removes it once it closed
  the comments.
- `prs.*.autoMerge`: set when auto-merge is on; in T3 the watcher follows the PR from then on.
- `deploys.pending`: merges waiting for their deploy. An entry without `sha` is a PR waiting to merge.
  Its `groups` decide which groups the watcher closes; an entry without a `pr` (push mode) must list them.
- `mainFailures`: tests that fail on the base branch too, for the main-fix group.
- `watcherUpdatedAt`: when the watcher last wrote its own bookkeeping. `updatedAt` stays yours.
- `watch.note`: one sentence on what you just did and what you wait on, rewritten on every wake.
  The dashboard shows it; nothing else reads it.

`events.jsonl`, next to `state.json`, is the activity history: one JSON line for each event the
watcher finds, each wake and take, and each change of a group's `state` or an item's `decision` or
`stage` made through `M patch` or by the watcher. Only the helper writes it; the dashboard reads it
for its feed and for how long a group has been in its state. Never read it on a wake.
