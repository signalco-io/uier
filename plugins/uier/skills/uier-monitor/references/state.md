# uier monitor state reference

Project state fields the watcher and `M status` read (add your own freely, but prefer these):

```json
{
  "project": { "id": "uier00000001", "name": "uier.io public feedback", "workspace": { "id": "…", "name": "uier" }, "site": "https://uier.io" },
  "repo": { "provider": "github", "host": "github.com", "url": "https://github.com/signalco-io/uier", "slug": "signalco-io/uier", "root": "<a checkout of the repository>", "base": "main" },
  "me": { "id": "u_…", "name": "…", "also": [{ "id": "u_…", "name": "…" }], "reviewer": null },
  "scope": "mine",
  "max": 6,
  "harness": { "kind": "t3", "prWatch": true, "threadId": "…", "pinnedAt": "2026-11-13T09:30:00Z", "title": "🛎 Monitor: uier.io public feedback", "fable": ["claudeAgent"], "routing": { "ui": { "provider": "…", "model": "…" } } },
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

- `repo.provider`: `github` (also the default for existing states) or `gitlab`. `repo.host` is the
  authenticated web/API hostname, including any port; `repo.url` is the credential-free web URL.
  `repo.slug` is the complete namespace/project path, including GitLab subgroups. For example:
  `{ "provider": "gitlab", "host": "git.podravka.io", "url": "https://git.podravka.io/team/project", "slug": "team/project", "base": "development" }`.
  The helper calls `glab api --hostname <host>` and URL-encodes the full project path.
- On GitLab, `pr`, `prs` keys, group PRs and deploy entry PRs contain the MR's project-local `iid`,
  never its global `id`. Use the actual MR URL for links. `workflow.mode: "pr"` includes MRs.
- GitLab `workflow.deploy`: `{ "kind": "deployments", "environment": "production", "branch": "development" }`
  follows environment deployment records; `{ "kind": "pipelines", "branch": "development" }` follows
  a confirmed deployment pipeline on that branch. `{ "kind": "none" }` explicitly closes at merge.
  A missing GitLab deploy configuration is an error. See [GitLab operations](gitlab.md).
- GitLab `workflow.requiredChecks` contains exact required CI job names. An empty array follows
  the aggregate head pipeline. Missing, manual, skipped or stale checks stay pending. Successful
  merged-results pipelines with a synthetic SHA require GitLab's `mergeable` decision and a
  synthetic commit whose parents include the current source head.
- GitLab `workflow.pipelineRequired`: defaults to requiring pipeline evidence. Explicit `false`
  allows a missing pipeline only when GitLab reports `mergeable` and no required jobs are named;
  record it only when the project's settings and repository notes permit that workflow.
- `harness.pinnedAt`: UTC timestamp of the last successful T3 orchestrator thread pin. Refresh on
  start, resume or tick, or when a wake reports the thread settled; clear on stop. It records the
  last pin, not a live thread-state check.
- `harness.title`: the T3 thread title last set, `🛎 Monitor: <project name>`. A tick renames the
  thread only when it differs; a first start or a person's resume always renames it.
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
  progress per comment (attached details, last renewal) in the watcher checkpoint; a lease removed from the
  state counts as done. `clear` lists comments whose agent the watcher removes when it ends.
- `groups.*.closing`: the replies drafted when the PR was approved (`SKILL.md`, Closing in uier). Per
  item: `reply` (may use `{sha}`, `{sha7}`, `{commitUrl}`), optional `status: "keep"` (reply only) or
  `verify: { reviewerId, expectedRevision, fixUrl, summary }`. The watcher removes it once it closed
  the comments.
- `prs.*.autoMerge`: set when auto-merge is on; in T3 the watcher follows a GitHub PR from then on.
  GitLab MRs are always polled, and the remote auto-merge flag determines whether a ready MR needs attention.
- `deploys.pending`: merges waiting for their deploy. An entry without `sha` is a PR waiting to merge.
  Its `groups` decide which groups the watcher closes; an entry without a `pr` (push mode) must list them.
- `mainFailures`: tests that fail on the base branch too, for the main-fix group.
- `watcherUpdatedAt`: when the watcher last wrote its own bookkeeping. `updatedAt` stays yours.
- `watch.note`: one sentence on what you just did and what you wait on, rewritten on every wake.
  The dashboard shows it; nothing else reads it.

The SQLite activity journal holds the latest 10,000 events per monitor, including wakes,
acknowledgements and changes to group state or item decisions and stages. The dashboard reads its
recent entries. The watcher commits each event batch together with its checkpoint and local state
updates. `M context --take` saves the receipt and acknowledges the inbox in one transaction.

- `watch.idleMinutes`: minutes without visible activity before slower event polling (default 15).
  `watch.idleIntervalSeconds`: idle event-read interval (default 300, bounded to 60–900 seconds).
  Active sessions/deploys and working leases keep the active cadence. Local controls, hold timers,
  wake retries and lease/release checks run at least every minute regardless of event backoff.
- Checkpoint fields `eventCheckedAt`, `lastActivityAt` and `eventIntervalSeconds`: event read cadence,
  separate from the every-minute process heartbeat.

One database per user, `~/.uier-monitor/monitor.sqlite` (`UIER_MONITOR_HOME` overrides the
directory), holds monitor registrations, project metadata, individually indexed items, groups
and PRs, events, settings and supervisor receipts. `M registry` lists projects by canonical
state directory. `M capacity --max N` sets the machine limit. Claims expire after 15 minutes
or when a group's state changes. Waiting monitors take turns in order of arrival. The monitor
stores reply cooldowns separately under `cooldowns/`.

The per-monitor usage record keeps numeric counters in at most 31 UTC day buckets.
It records actual HTTP attempts (including retries), consumed body bytes, elapsed request time,
measured database RU and coverage, delivery failures, wakes and idle model wakes. It contains no
feedback, tokens, endpoints or identity values. `M usage` optionally prices observed RU at a
supplied rate; it never guesses missing costs. Old servers without the metering header leave
those requests unmeasured. The two bounded monitor read tools report database charges including
the HTTP rate-limit counter; later TTL deletion, storage, egress and hosting are excluded.
