# Starting the uier monitor

Read this on a first start, when `state.json` lacks something below, or when `SKILL.md` sends you
here (several projects, re-arming the watcher, re-detecting the workflow, replacing the token,
fallback mode).

## First start

1. **uier tools.** You need the uier MCP tools (`list_feedback_events` and the rest). Without them,
   stop and tell the person how to connect: `claude mcp add --transport http uier https://uier.io/api/mcp`,
   then `/mcp` → uier → Authenticate (other clients use an access token, see the uier MCP docs).
2. **Project and person.** `list_projects` (follow `nextCursor`). Match the argument as an id, then
   as an exact name ignoring case, then as a unique prefix. Ask only if it stays ambiguous. `me` is
   `actingAs` (`userId`, `name`). Add accounts from `also=`, earlier state or the person's memory notes
   that they confirmed as theirs. Record the connection's `actingAs` as `harness.mcpActingAs` on every
   start and resume: the person can reconnect it as another of their accounts between sessions.
   When the monitor registry (Several projects, step 2) holds this project with a state folder in
   another repository, don't start a second monitor here: launch or resume it there (Several
   projects), unless the person asked to move it to this repository.
3. **Helper and state.** Install the helper and the fix-session rules (`SKILL.md`, Files and the
   helper), then `mkdir -p STATE/briefs STATE/logs`.
4. **Harness.** Detect it and pick models (below and `SKILL.md`, Models). Record `harness`.
   In T3, pin and name this orchestrator thread as described below.
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

## Several projects

When the person names several projects, or one whose monitor runs in another repository, this thread
only launches monitors: no helper install, state, pin or watcher here. Each project gets its own
thread, titled `🛎 Monitor: <project name>`, in the T3 project that holds its code. Outside T3, list
one start command per project with the checkout to run it in, and start nothing.

1. **Projects.** `list_projects` once (follow `nextCursor`) and match each name as in First start,
   step 2. Ask once about every name that stays ambiguous or unknown, and carry on with the rest.
2. **Repository.** Every monitor registers in `~/.uier-monitor/monitors/*.json`
   (`UIER_MONITOR_HOME` moves the folder) with its `stateDir`, `project.id` and `repo`; read them in
   one command and ignore entries whose `stateDir` is gone. A registered project's T3 project is the
   `t3_project_list` entry whose `workspaceRoot` starts its `stateDir`, else the one whose
   `repositoryIdentity.displayName` equals `repo`. For the rest, ask the person once, for all of
   them, which T3 project holds the code (offer this thread's project first).
3. **Running already?** For a registered project, read `stopped` and `harness.threadId` from
   `<stateDir>/state.json`, and the watcher from the second line of
   `node <stateDir>/../monitor.mjs status --state <stateDir>` (`watcher running` or `watcher stopped`).
   When `t3_thread_read` finds that thread and it isn't `archived`, rename it if its `title` differs
   (`t3_thread_update` with its `threadId`), then:
   - not stopped and the watcher runs: leave it;
   - otherwise: resume it there with `t3_thread_send` (`mode: "queue"`) and "Resume the uier monitor
     for project <id> with the uier-monitor skill", plus `: <options>` when the person gave any.

   Without such a thread, launch a new one (step 4); it takes the saved state over.
4. **Launch.** One `t3_thread_launch` per project, all in one batch: `projectId` the T3 project,
   `title` `🛎 Monitor: <project name>` (one line, at most 60 characters), `message` "Start the uier
   monitor for project <id> with the uier-monitor skill" plus `: <options>`, and `clientRequestId`
   `um-launch-<projectId>-<UTC time of this request>`, the same on a retry. Omit the model, modes and
   workspace strategy: the thread inherits this one's and runs in the project's checkout.
5. **Report.** One table: project, T3 project, thread link, and started, resumed, already running or
   waiting on the person. Nothing else happens in this thread.

With several projects, `status` prints each registered project's `status` (steps 1 and 2 only) and
launches nothing. `stop` sends each monitor's thread "Stop the uier monitor for project <id> with the
uier-monitor skill: stop" (`t3_thread_send`, `mode: "queue"`). When that thread is gone or archived,
stop it from here with that repository's helper: `stop`, then
`patch '{"stopped":true,"watch":{"stopped":true}}'`, each with `--state <stateDir>`.

## Harness

Detect the harness from your tools:

| Harness | You have | Sessions | Waiting | PR updates |
| --- | --- | --- | --- | --- |
| T3 Code | `delegate_task`, `orchestrator_capabilities` (t3-code server) | `delegate_task`, any listed provider | background command | `watch_pull_request` until auto-merge, then the watcher |
| Claude Code | `Agent` with `isolation` | `Agent`, Claude models only | background command | the watcher polls PRs |
| Codex | `spawn_agent` | `spawn_agent`, its own models | foreground loop | the watcher polls PRs |
| Other | none of these | none: max 1, build each group yourself | foreground loop | the watcher polls PRs |

Record `harness.prWatch: true` only in T3 for GitHub repositories; use `false` for GitLab so the
helper polls every open MR. In T3, call `orchestrator_capabilities` once, plus
`search: "gpt"`, `search: "claude"` and `search: "fable"` for the full model lists, and record your
own thread id (`harness.threadId`). Record which Claude instances list a `claude-fable-*` model.

On first start, call `t3_thread_organize` with `action: "pin"` and no `threadId` (this thread),
then `M patch` `harness.pinnedAt` to the successful pin's UTC timestamp. Name the thread too
(`SKILL.md`, T3 thread) and record `harness.title`. Repeat the pin on every
active resume or tick, and also call `action: "unsettle"` without `threadId` on those resumes.
A missing timestamp means the pin has not been recorded; record it only after success. On ordinary
wakes, make no extra thread lookup or organize call unless the harness reports this thread settled;
then unsettle and pin it and refresh the timestamp. On `stop`, unpin this thread with
`action: "unpin"` (no `threadId`) and clear `harness.pinnedAt` using `M patch`. These actions
apply to the orchestrator, never its fix sessions. A stopped monitor's automated tick does none of
them; `status` and `dashboard` also leave the thread alone.

T3 has no settle-behaviour setting yet. Pinning and unsetting the settled state are the current
workaround; [issue #709](https://github.com/signalco-io/uier/issues/709) tracks switching to
"never" when that setting becomes available.

**Provider instance:** `claude=`/`openai=` when given, else your own instance for your own provider,
else the instance whose id equals its driver (`claudeAgent`, `codex`), else the first usable one. A
provider counts when it lists `canRunChildTask: true` and no constraints.

**Elsewhere.** Claude Code: `Agent` with `subagent_type: "general-purpose"`, `isolation: "worktree"`,
`model: "opus"` (or `"fable"` where `SKILL.md` routes to Fable and the plan offers it) and the
effort from `SKILL.md` (this skill asks for it). Codex: the inherited model, with the effort when
`spawn_agent` takes one.

## Repository workflow

First inspect `git remote get-url origin`, accepting HTTPS, `ssh://` and scp-style SSH remotes.
Record `repo.root`, `repo.provider` (`github` or `gitlab`), `repo.host` (web/API host, including
a port when needed), `repo.slug` (full namespace/project path, including subgroups, without `.git`)
and `repo.url` (credential-free canonical web URL). Use repository notes or the authenticated CLI
to identify an unfamiliar self-managed host; don't guess that every non-GitHub remote is GitLab.
Confirm an SSH alias's web/API host from the CLI config. Preserve the repository's documented
target branch, even when it differs from the default branch.

For GitLab, read [GitLab operations](gitlab.md) and follow its workflow detection instead of the
GitHub commands below. On resume, fill missing provider fields before any host poll; old states
without `repo.provider` use GitHub for compatibility.

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

- **T3 with the local `t3 thread send` CLI** (required when available):
  `M watch --persistent --detach --thread <this thread id> --replace` (pass `--t3-cli <absolute path>`
  if needed). The detached script checks uier, PRs and deploys before sending a model message; it
  sends no idle heartbeats. A busy thread queues the message without interruption, using its
  existing model and provider. After startup, check `M status` once for a live PID and a fresh
  heartbeat. Only then disable an old interval fallback with `schedule_task enabled: false`, and
  record its id in `watch.scheduledTaskId` and `watch.mode: "persistent"`. Keep an existing
  persistent watcher when its target thread is still correct; don't replace it on routine wakes.
  The helper also selects this mode automatically for a saved T3 thread, including when an old
  prompt calls `M watch --replace`. It detaches rather than returning an idle completion to the model.
  Never choose a one-shot or interval model fallback while this transport is available.
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
- Event reads run every minute during work and for 15 minutes after visible activity, then every
  five minutes while idle. A new event restores the fast cadence. Safety reconciliation still
  runs every 15 minutes, with compact state and every returned page. `watch.idleMinutes` and
  `watch.idleIntervalSeconds` adjust the idle thresholds (five minutes by default, capped at 15).
- It reads `state.json` at least every minute, so new pending deploys, PRs, the hold timer (`watch.wakeAt`),
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

Without a watcher token, the helper refuses to start instead of silently spending model tokens.
Only when no event transport/token can be used, explicitly pass `--allow-model-polling` and tell
the person this mode costs model usage. With that opt-in, `M watch` still follows deploys and PRs
and exits with `poll-uier` every 15
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

## Usage accounting

`M usage` reports requests, retries, failures, JSON request/consumed response bytes, elapsed HTTP
time, database RU coverage and idle model wakes over up to 31 UTC days. Optional
`--ru-price-per-million N --currency EUR` estimates only measured RU at the supplied rate.
Unknown charges stay unknown; this is not hosting, transfer, AI token accounting or an invoice.
The dashboard and `M status` call out idle wakes and one-shot watching. Do not start a model
to check this telemetry. An authentication error wakes once; persistent watching never changes
to periodic model polling unless the costly fallback was explicitly enabled.
