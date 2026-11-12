# Starting the uier monitor

Read this on a first start, when `state.json` lacks something below, or when `SKILL.md` sends you
here (re-arming the watcher, re-detecting the workflow, replacing the token, fallback mode).

## First start

1. **uier tools.** You need the uier MCP tools (`list_feedback_events` and the rest). Without them,
   stop and tell the person how to connect: `claude mcp add --transport http uier https://uier.io/api/mcp`,
   then `/mcp` → uier → Authenticate (other clients use an access token, see the uier MCP docs).
2. **Project and person.** `list_projects` (follow `nextCursor`). Match the argument as an id, then
   as an exact name ignoring case, then as a unique prefix. Ask only if it stays ambiguous. `me` is
   `actingAs` (`userId`, `name`). Add accounts from `also=`, earlier state or the person's memory notes
   that they confirmed as theirs. Record the connection's `actingAs` as `harness.mcpActingAs` on every
   start and resume: the person can reconnect it as another of their accounts between sessions.
3. **Helper and state.** Install the helper and the fix-session rules (`SKILL.md`, Files and the
   helper), then `mkdir -p STATE/briefs STATE/logs`.
4. **Harness.** Detect it and pick models (below and `SKILL.md`, Models). Record `harness`.
5. **Repository.** Read the repository notes if they exist (`docs/uier-monitor.md` or
   `.uier/monitor.md`; they override what you detect), then detect the workflow (below). Record
   `repo` and `workflow`.
6. **Watcher token.** `M patch` the project and `me` first, then run `M check` and follow Watcher
   token below.
7. **Sync.** `list_feedback` with `status: "open"` (all pages). Triage every id that isn't in the
   state yet, and record a decision for each, skipped ones included, so they never come back.
8. **Start work.** Fill the free session slots (`SKILL.md`, Sessions).
9. **Arm and report.** Start the watcher (Waiting, below) and end the turn with a short table:
   comment, decision, session, state.

## Harness

Detect the harness from your tools:

| Harness | You have | Sessions | Waiting | PR updates |
| --- | --- | --- | --- | --- |
| T3 Code | `delegate_task`, `orchestrator_capabilities` (t3-code server) | `delegate_task`, any listed provider | background command | `watch_pull_request` until auto-merge, then the watcher |
| Claude Code | `Agent` with `isolation` | `Agent`, Claude models only | background command | the watcher polls PRs |
| Codex | `spawn_agent` | `spawn_agent`, its own models | foreground loop | the watcher polls PRs |
| Other | none of these | none: max 1, build each group yourself | foreground loop | the watcher polls PRs |

Record `harness.prWatch: true` only in T3. In T3, call `orchestrator_capabilities` once, plus
`search: "gpt"`, `search: "claude"` and `search: "fable"` for the full model lists, and record your
own thread id (`harness.threadId`). Record which Claude instances list a `claude-fable-*` model.

**Provider instance:** `claude=`/`openai=` when given, else your own instance for your own provider,
else the instance whose id equals its driver (`claudeAgent`, `codex`), else the first usable one. A
provider counts when it lists `canRunChildTask: true` and no constraints.

**Elsewhere.** Claude Code: `Agent` with `subagent_type: "general-purpose"`, `isolation: "worktree"`,
`model: "opus"` (or `"fable"` where `SKILL.md` routes to Fable and the plan offers it) and the
effort from `SKILL.md` (this skill asks for it). Codex: the inherited model, with the effort when
`spawn_agent` takes one.

## Repository workflow

Detect, then record in `workflow` with `detectedAt`:

```bash
gh repo view --json nameWithOwner,defaultBranchRef,viewerPermission,squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed,deleteBranchOnMerge
gh api repos/<slug> --jq '{allow_auto_merge, allow_update_branch}'
gh api repos/<slug>/rules/branches/<base>        # pull_request, required_status_checks, merge_queue
gh workflow list --json name,path,state           # then read the workflows that run on push to <base>
```

- `mode`: `pr` when a rule or the repository docs require pull requests, or when unsure; `push`
  only when the docs say to push directly and no rule requires a PR.
- `base`: the docs' target branch, else the default branch.
- `method`: the docs' merge method, else squash, merge or rebase, the first one allowed.
- `requiredChecks` and required approvals from the rules. With approvals required, tell the person
  when a PR is ready for review; the PR watch wakes you when they review.
- `strict`: `true` when the `required_status_checks` rule has
  `strict_required_status_checks_policy: true` (PRs must be up to date before merging), else `false`.
- `mergeQueue`: `true` when a `merge_queue` rule exists.
- `deploy`: a GitHub Actions workflow that runs on push to `base` and deploys (look for deploy,
  release or production): `{ "kind": "actions", "workflow": "<file>", "branch": "<base>", "pathsIgnore": [...] }`.
  Otherwise GitHub deployments for production: `{ "kind": "deployments", "environment": "Production" }`.
  Otherwise `{ "kind": "none" }`: comments close at merge.
- `rerun`: how to re-run a failed deploy, from the repository notes (`failed` jobs by default, or
  `all` when the notes say so).
- `knownFlaky`: test names the notes list as flaky.

## Watcher token

After `M check`:

- If the token is missing or refused, get one:
  - When the current MCP connection has "Create access tokens" (`tokens:create`), call
    `create_access_token` with a name such as "uier monitor — <project>", this project's
    `workspaceId` and `projectIds: [<projectId>]`,
    `scopes: ["feedback:read", "screenshots:read", "feedback:assign", "feedback:status", "feedback:reply"]`,
    `days: 30` and a fresh `idempotencyKey`. Request only operations the connection has. If it lacks
    a required operation, use the next option; never broaden the token or reconnect on its behalf.
    The returned `token` is a secret: set `umask 077` in the writing shell, write it directly to a
    new file in the harness scratchpad (mode `0600` from creation; no shell arguments, output or logs
    containing it), run `M token --from-file <file>`, delete the file in a cleanup step, then run
    `M check`. Never put it in chat, packets or state.json. A retry must use the same key and input;
    it returns metadata only. If the first response was lost, have the person revoke the listed token
    before creating a replacement; never create duplicates automatically.
  - Otherwise, in T3 call `request_secret` with `delivery: "file"`, label "uier access token for
    <project>", and a reason that says where to create it: uier → Account → Coding agents → Access
    tokens, this project, operations "Read feedback", "Read screenshots", "Assign feedback", "Change
    status" and "Reply to feedback", 30 days. Then `M token --from-file <file>` and `M check` again.
  - Elsewhere: ask the person once to create the same token and either export `UIER_MCP_TOKEN` in the
    environment that starts the coding tool or run `M token --from-file <file>`.
- Make sure `actingAs` is the person or one of their accounts. Until a token works, use fallback mode.
- Record `M check`'s `lease` as `watch.lease` and its `writes` as `watch.writes`. With `lease:
  "unsupported"` (no "Assign feedback"), everything works except the working spinner. With `writes:
  "missing"` (no "Change status" or "Reply to feedback"), status changes and replies depend on your
  MCP connection alone, and the watcher can't close comments after deploys. Either way, replace the
  token as above and tell the person once if you can't.
- When `M check`'s `actingAs` differs from `harness.mcpActingAs`, the two connections act as
  different accounts, and the MCP connection may not see the person's private threads: set
  `watch.writer: "watcher"` (`SKILL.md`, Writing to uier). Otherwise set it to `"mcp"`.

## Waiting

- **T3 with the local `t3 thread send` CLI** (preferred):
  `M watch --persistent --detach --thread <this thread id> --replace` (pass `--t3-cli <absolute path>`
  if needed). The detached script checks uier, PRs and deploys before sending a model message; it
  sends no idle heartbeats. A busy thread queues the message without interruption, using its
  existing model and provider. After startup, check `M status` once for a live PID and a fresh
  heartbeat. Only then disable an old interval fallback with `schedule_task enabled: false`, and
  record its id in `watch.scheduledTaskId` and `watch.mode: "persistent"`. Keep an existing
  persistent watcher when its target thread is still correct; don't replace it on routine wakes.
- **A harness webhook**: create its event-triggered task with a fixed resume prompt bound to this
  thread, and use `M watch --persistent --detach --notify-file STATE/wake-url --replace`. Store the
  returned bearer URL directly in that `0600` file from creation (`umask 077`); never echo it, place
  it in state or arguments, or enable remote access on the person's behalf. Configure replay
  deduplication on the request body's `batch`, and coalescing on `projectId`, when the harness
  supports it. The payload holds only those identifiers, never feedback. Verify readiness before
  disabling a timer. No webhook URL or no supported task: use the next option, without claiming an
  idle-token saving.
- **Background commands** (Claude Code, also inside T3): run `M watch --replace` with
  `run_in_background: true` and `timeout: 7200000`, then end the turn. You're woken when it exits
  (within two hours). Don't poll it and don't call `t3_background_wait` for it.
- **Neither** (Codex, Other): run `M watch --max-minutes 10` in the foreground with a tool timeout
  above 10 minutes, handle what it returns, and run it again.

How the watcher behaves:
- It reads `state.json` every cycle, so new pending deploys, PRs, the hold timer (`watch.wakeAt`),
  agent leases and closing drafts need only `M patch`, not a restart. While a lease is working it
  runs a cycle at least every 60 seconds.
- Ordinary events collect for ten seconds (`--batch-seconds`, at most thirty); duplicates coalesce,
  but separate replies, status changes and deployed PRs stay separate. Reassignment, agent removal,
  stop-work and auth or lease errors skip that delay.
- Quiet events (merges it recorded, comments it closed) wake no one; they arrive with the next wake.
- A persistent watcher keeps the inbox until `context --take` or `take` acknowledges it. A failed
  notification retries the same batch after a minute; a delivered but unconsumed wake (a stopped
  thread, a usage limit) is sent again after thirty minutes. `M status` shows a running delivery
  outage, and the next context reports it once as `wakeOutage`.
- It never polls running delegates.

## Fallback mode

Without a watcher token, `M watch` still follows deploys and PRs and exits with `poll-uier` every 15
minutes. Attach agents yourself (`SKILL.md`, Starting one, step 4); there is no working spinner, and
you close comments yourself after deploys. On `poll-uier`: call `list_feedback_events` with
`watch.mcpCursor` (null the first time, then the cursor it returns), skip events made by a connector
or a guest, run `list_feedback` with `status: "open"` (the event feed has missed comments), handle
what's new, and re-arm. Without the helper at all, use the harness's scheduler every 15 minutes (T3:
`schedule_task` bound to this thread with `freshSession: true`) and tell the person this mode costs
more tokens. An interval task starts a model before its prompt runs, so a no-change check inside that
prompt saves nothing. Never run interval ticks while a healthy watcher runs. If a watcher dies,
restart it on manual resume or under an existing OS process supervisor; this skill doesn't install a
system service or claim that a detached process survives an OS restart.
