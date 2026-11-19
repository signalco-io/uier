# uier monitor

The `uier-monitor` agent skill watches a uier project and resolves its feedback end to end. It
triages new comments, runs fix sessions, merges, waits for the deploy and reports back in uier. This
page covers how to run it here, how it works, and the repository notes the skill reads at start.

## Run it

In Claude Code, or a T3 Code thread on Claude, in a checkout of this repository:

```text
/uier-monitor uier.io public feedback
```

Add `status` to see where things stand, or `stop` to stop watching. Running it again resumes from
the saved state. In Codex, ask it to use the uier-monitor skill for the project. Other options
(`max=`, `global=`, `scope=`, `also=`, provider instances) are listed in the skill.

To watch several projects, separate them with commas:

```text
/uier-monitor uier.io public feedback, uier.io user feedback
```

In T3, the thread you type it in starts one monitor thread per project, in the T3 project whose
checkout holds that project's code. The monitor registry under `~/.uier-monitor/monitors` knows
where each project was monitored before; for a new one the skill asks. A project whose monitor still
runs keeps its thread, and a stopped one resumes in its old thread when that still exists. Elsewhere
the skill lists one start command per project instead.

In T3, every monitor thread is named `🛎 Monitor: <project name>`. The orchestrator names and pins
its own thread on first start and every active resume or tick, and unsettles it on resume. Ordinary wakes only repeat those actions when the harness reports
the thread settled. `stop` unpins it; a stopped monitor's automated ticks leave it alone.
T3 has no settle-behaviour setting yet; [issue #709](https://github.com/signalco-io/uier/issues/709)
tracks switching to "never" when it becomes available.

The skills live in `plugins/uier/skills/`, with repository discovery aliases in `.claude/skills/`
and `.agents/skills/`. For another repository, [install the uier plugin](agent-plugins.md) from
this repository's Claude Code or Codex marketplace. It includes the skills and the MCP connector.
The installed Claude Code command is `/uier:uier-monitor <project>`; in Codex ask it to use
uier-monitor for the project. Installing the plugin starts no monitoring; invoking the monitor
grants the scope described in the skill. Manual skill links remain an option.

### On-demand project monitors

Use `/uier-orchestrator Project A, Project B` in a local T3, Codex or Claude Code session. The installed Claude command is `/uier:uier-orchestrator`. Select a checkout for each project once. Idle projects share a detached Node process; it checks every five minutes and launches a project-specific uier-monitor session only when an eligible comment opens. T3 uses its local CLI, Codex uses `codex exec` and Claude uses `claude -p`. Each uses the configured CLI profile and permissions.

A project can enroll several of one person's accounts, such as a personal and a work account. Discovery reads each account with its own Read feedback token, because uier never combines accounts' permissions. Store a token for each additional account under the keychain account `<project id>:<account id>`. A missing token stops that project's discovery with an error instead of skipping the account. A stopped monitor is handed off only when its saved accounts match the enrollment.

Use `allow` or `remove` with named projects to change the allowlist, `status` to inspect it, `stop` to pause dispatch, and a bare invocation to resume. Existing independent monitors keep their owners. An explicit handoff can reuse a stopped project's saved state. An in-progress fix, open PR, pending deploy, failed write or verification keeps the managed worker open. When comments and deliveries are complete, the watcher stops, T3 settles its thread, and native sessions retain their transcripts. New work gets a new thread.

In T3, the supervisor thread is named `🧭 uier orchestrator` and pinned on start and resume. Resume also unsettles the thread. The supervisor saves the thread ID and UTC pin timestamp. Stopping unpins the saved supervisor thread and clears its pin receipt.

The local dashboard shows supervisor health, harness, last heartbeat and each allowed project's phase or error. The supervisor keeps its allowlist, checkout mappings and session receipts in `~/.uier-monitor/monitor.sqlite` (`UIER_MONITOR_HOME` overrides the home). Installation starts nothing. Restart the supervisor after a machine restart. See the [orchestrator skill](../plugins/uier/skills/uier-orchestrator/SKILL.md) for permissions, handoff and recovery.

### GitHub and GitLab

The monitor supports GitHub and GitLab, including self-managed hosts such as `git.podravka.io`.
It detects the host from the repository remote and uses an authenticated `gh` or `glab` CLI.
GitLab merge requests keep their full host and subgroup path; the monitor's existing `pr` state
fields hold their project-local IIDs. Older states without a provider continue to use GitHub;
resuming a GitLab monitor records its host before polling.

On GitLab the helper follows merge requests, required pipeline/jobs, merge blockers and deployment
records itself, including in T3. Deployment evidence comes from the configured environment and
target branch, or a branch pipeline confirmed to deploy. It checks that the deployed commit contains
the merge before closing feedback. Missing deployment configuration stays an error. See the
[GitLab workflow reference](../plugins/uier/skills/uier-monitor/references/gitlab.md) for detection,
merge commands, logs and retries. Adding support does not start or alter existing monitors.

### The watcher's access token

The watcher checks uier with its own access token, so waiting costs no model tokens. When the MCP
connection has **Create access tokens**, the skill calls `create_access_token` for this project with
Read feedback, Read screenshots, Assign feedback, Change status and Reply to feedback, requesting
30 days (capped at the creating connection’s hard expiry). These operations must already
belong to the connection. The new token cannot create more tokens.

The tool returns the secret once. Set `umask 077` in the writing shell before creating the file.
The skill writes it directly to a new `0600` file in the harness scratchpad, runs `monitor.mjs token --project <id> --from-file <file>` to store it in the macOS
keychain (service `uier-mcp`, account: the project id), and deletes the file in cleanup. The secret
must never appear in chat, command arguments, logs, packets or monitor state. Retries use the same key
and return metadata only. If the first response was lost, revoke the listed token before replacing it.
The token appears under Account → Coding agents → Access tokens, marked with the connection that
created it, and can be revoked there.

Without that permission or the required operations, the skill keeps the existing flow: create a token
in Account → Coding agents → Access tokens, select the project, choose Read feedback, Read screenshots,
Assign feedback, Change status and Reply to feedback, and use 30 days. In T3 Code it asks with `request_secret` and file delivery, then
imports the file with `monitor.mjs token --from-file`. Elsewhere, import a file or export
`UIER_MCP_TOKEN` in the environment that starts the coding tool. Without a token, the helper refuses to start by default. `--allow-model-polling` explicitly
enables the 15-minute model fallback and makes its usage visible.

### The working spinner

While a fix session builds, uier shows a small spinner by the agent's avatar on its comments. The
spinner is a five-minute lease that has to be renewed, and the orchestrator sleeps while sessions
run, so the watcher keeps it: when a session starts, the orchestrator writes the session's agent,
model, effort and thread id to the group's `agentLease` in project state. The watcher attaches that
agent with `set_feedback_agent`, renews `set_feedback_agent_working` every two minutes (checking at
least every minute while a lease is live), and turns the spinner off when the session reports. The
agent stays attached until the comment closes. `monitor.mjs status` lists the leases.

An optional `agentLease.sessionUrl` carries the existing desktop session link supplied by the
harness. The watcher forwards it to `set_feedback_agent`, including when it changes or is removed.
For T3 Code, pass `t3-thread://v2/<environmentId>/<threadId>` with the correct environment id;
thread ids may include colons and literal uppercase `%3A` (no other percent encodings, including
`%3a`, and none in the environment id). Agent kind and session id alone cannot identify the desktop app. Codex accepts
`codex://threads/<UUID>` and Claude accepts `claude://claude.ai/chat/<UUID>`. Omit the field when the
harness has no supported link. uier rejects other routes, queries and fragments. Links appear only
in member agent details and never in guest responses or connected-service deliveries. See the
[validated formats and official documentation](../apps/web/docs/assignee-agents.md#desktop-session-links).

uier only lets the connection that attached an agent report its work, which is why the watcher
attaches it rather than the orchestrator. When its token can change status, that attachment also
moves the comment to In progress; with an older token the orchestrator does it. With a token without
"Assign feedback", or without a token, the orchestrator attaches agents itself as before and there is
no spinner; the watcher says so once.

### Status changes and replies

The orchestrator's MCP connection and the watcher's token can act as different accounts. If the
connection is signed in as another of the person's accounts, it can't see their private threads,
so its status changes and replies fail with `not_found`. `monitor.mjs check` reports whether the
token can change status and reply (`writes`). When the two act as different accounts, or a write
through the connection fails on a comment the watcher can read, the orchestrator writes with
`monitor.mjs call <tool> '<json>'`, which uses the token. A write that fails both ways is kept in
the item's `writePending`, retried on every wake and listed by `monitor.mjs status`, and every
monitor message starts with a **Needs you:** line that names the fix: reconnect the uier connection
as the comments' author, or create a token with the missing operation.

Rate limits are different: the helper preserves the server's full `retryAfterSeconds` and defers
reply retries until that deadline, using the same idempotency key and input. The watcher continues
reads, lease renewals and status updates during the cooldown. Watchers and `monitor.mjs call`
using the same endpoint and token share a small deadline file under
`~/.uier-monitor/cooldowns` (`UIER_MONITOR_HOME` overrides the root). Its filename is a connection
hash; it stores only the deadline, never a token, endpoint, reply or key. A cooldown needs no account
or permission change. HTTP 429 responses also return their retry deadline without blocking the
watcher in a sleep/retry loop.

### Thread cards in the monitor thread

When a comment starts waiting on you, the monitor shows its [thread card](mcp.md#thread-cards)
with `show_feedback` in the same message. That happens for a question you need to answer, a
verification, a blocked group, a pull request that needs your approval, a deploy it can't fix and a
write that didn't reach uier. In hosts that render MCP Apps, such as T3 Code, the card keeps the
thread's status current while the thread is open. Each card appears once, when the need appears,
and a turn shows at most three; the monitor links the rest. Routine progress (triage, sessions,
pull requests, merges, closing) and ticks show no cards. Ask the monitor to show any thread to get
its card. When a card can't be shown (another host, or a connection that can't see the comment),
the message links the comment instead.

### Where its files are

The monitor, dashboard and supervisor require Node 24 or newer. The local database is
`~/.uier-monitor/monitor.sqlite`. Set `UIER_MONITOR_HOME` to select a different directory.
Projects are keyed by the canonical `<git common dir>/uier-monitor/<projectId>` directory, so
worktrees share one monitor. That directory holds watcher PID and diagnostic log files, briefs,
screenshots and CI logs. The database stores project settings, feedback items, job groups, PRs,
inbox entries, watcher checkpoints, supervisor registrations and worker receipts. A one-time
manual cutover from JSON requires stopping old writers, backing up their files and transferring
their records before starting the new helpers. Stopped monitors stay stopped.

The usage record holds numeric counters for up to 31 UTC days, including HTTP attempts, retries, failures,
consumed JSON body bytes, elapsed HTTP time, measured database RU with coverage, delivery failures
and idle model wakes. It contains no feedback, endpoints, identities or tokens. `usage` prints it;
optional `--ru-price-per-million N --currency EUR` estimates only measured RU at the supplied rate.
Missing measurements stay unknown. AI token usage, hosting CPU/memory, storage and transfer are
excluded. The dashboard details and `status` show the counters and call out idle model wakes.
`context --take` saves the compact wake and its delta baseline in the same transaction that
acknowledges its events. `context --recover` returns the most recent event-bearing packet.
Wake delivery retries leave events pending until acknowledged. For a quick look:

```bash
node "$(git rev-parse --path-format=absolute --git-common-dir)/uier-monitor/monitor.mjs" status --project uier00000001
```

### The dashboard

`dashboard.mjs`, next to `monitor.mjs`, serves a local page that shows every monitor on the machine,
whichever repository it runs in:

```bash
node "$(git rev-parse --path-format=absolute --git-common-dir)/uier-monitor/dashboard.mjs" --open
```

It opens `http://127.0.0.1:4780`. `--detach` keeps it serving after the command returns
(`dashboard.mjs stop` ends it), `--port N` picks another port, `--state DIR` adds a monitor it didn't
find, `--json` prints one snapshot and exits, and `--no-icons` keeps the server from fetching the
projects' site icons. The skill starts it too: `/uier-monitor dashboard`
(in Claude Code with the plugin, `/uier:uier-monitor dashboard`), with or without a project.

Every monitor is a card, and the cards sit side by side, so you see all of them without opening
anything. A card's title starts with the project's icon: its site's favicon, or the first letter of
its name in a small tile while there is none, as in the uier app. uier serves project icons only to
signed-in members, so the dashboard's server fetches the icon itself from the site in the state file
(the page's `<link rel="icon">`, then `/favicon.ico`, `/favicon.svg` and `/apple-touch-icon.png`),
keeps only bytes that are an image and serves it from `/api/icon/…`; the page never contacts the site
and gets no token. Its requests reach only the site's own origin (scheme, host and port, which may be on
this machine) or public addresses on port 80, 443 or the site's port: declared icons and redirects
that point at this machine, the local network or a cloud metadata address are refused, host names
are checked on each connection's own DNS answer, and redirects (at most 5) are checked hop by hop. A found icon is kept for a day, a missing one is tried again after 30 minutes.
A card shows:

- **Watcher health:** running, waiting (a running watcher with nothing in progress), stopped, not
  running or not responding, with failing wake delivery and usage limits called out. Low disk space
  shows once, at the top of the page. Stopped and inactive monitors are dimmed.
- **Sessions:** how many of the monitor's slots are working.
- **Waiting on:** sessions still working, a free session slot on this machine (when the machine's
  limit holds the monitor back), pull requests to merge, deploys to finish, a timer, events
  the orchestrator hasn't taken yet, or you. Under it, one small muted line gives the orchestrator's
  last note (what it just did); hover it for the whole note, or open the card's details to read it in full.
- **Work in progress:** one line per group under Building, In review, Pull request, Deploying or
  Blocked, with its comments, pull request, agent, time in that state and a link to the session,
  then the queued comments and what needs you (open questions, comments ready to verify, blocked
  groups and failed uier writes). A speech bubble marks links to uier comments and a pull request
  icon marks links to GitHub or GitLab, keeping self-managed hosts and subgroup paths. The agent shows its maker's mark (Claude, OpenAI or Cursor), the model's
  name as uier writes it ("Claude Opus 5.5") and the reasoning level in words ("Extra high").

**Session links.** T3 Code opens `t3-thread://` links only inside its own chat, so the page links a
T3 session through T3 Code's hosted thread link (`https://app.t3.codes/threads/…`, the one Copy
thread copies), which opens it in the desktop app, the mobile app or the browser. Codex and Claude
desktop session links keep their own schemes.

**Updates move.** The page changes what is there instead of redrawing it: a group that changes state
shows the new state where it is and then glides to its new place, a group that leaves the pipeline
says Done or Cancelled for a moment before it goes, new rows fade in and changed numbers and words
are highlighted briefly. The dot of a group being worked on beats. With reduced motion turned on in
the system, nothing moves.
Relative times ("5 min ago", "in 3 min", "for 2 h") stay current between updates: each one's
words change the moment they would read differently (every second while one counts seconds), and
nothing else on the page is redrawn or highlighted for it.

**Show details** opens a card across the page and adds each group's note, the watcher's version and
last check-in, the activity feed, comments closed per day, the median time from start to close and
the wakes of the last 24 hours. Badges next to the title count the monitors, the ones working and the
ones waiting. The totals above the cards count every monitor that isn't stopped or
inactive. Sessions working is the machine's count (every monitor's sessions and the slots claimed
for sessions about to start) against the machine's limit when that is lower than the monitors' own
maximums added up, with how many monitors wait for a slot.
Each total has a small figure beside it: a slot meter for the sessions working, a line of the
last 24 hours for the queued groups and the open pull requests (walked back from now through the
journal's group events, sampled on the half hour; flat where the journal doesn't reach), a pip per
comment that needs you in the colour of what it needs (questions, comments to verify, blocks and
failed uier writes, named under the number), and a bar per day of the last 14 for the comments closed.

#### Feedback on the dashboard

uier's staff review the dashboard with uier itself. Start it on its default port with the project's
public id and open the address it prints:

```bash
node plugins/uier/skills/uier-monitor/scripts/dashboard.mjs --dev --review 4qkVLP8gA_7ly406tHc-Q
```

`--review` loads the toolbar for the **uier monitor dashboard** project (`uier00000003`, in the uier
workspace, staff only). The project's addresses are `http://127.0.0.1:4780` and
`http://localhost:4780`, so the toolbar only works on the default port. The page includes the toolbar
only when the dashboard starts with a review project: `?review=true` alone changes nothing on a
dashboard without one. A dashboard already running without `--review` (or `--dev`) is restarted with
it on the same port, and the command prints the review link to open.

To have every dashboard on your machine load the toolbar, including the one the monitor skill
starts, save the project once:

```bash
node plugins/uier/skills/uier-monitor/scripts/dashboard.mjs review 4qkVLP8gA_7ly406tHc-Q
```

It goes to `~/.uier-monitor/dashboard-settings.json` and applies to every start without `--review`.
`review` on its own prints it, and `review off` forgets it. The comments are in the app
under the uier workspace, and `/uier-monitor uier monitor dashboard` resolves them like any other
project's once your uier connection includes the project. Anyone else passes their own project's id; the page loads nothing from uier without the
flag.

**Discovery and activity.** The dashboard reads registered monitor directories from SQLite.
It shows watcher health, recent activity and machine-wide session capacity. The database keeps the
latest 10,000 activity events per monitor. The dashboard shows the watcher log when the journal is
empty. A monitor nobody touched for a day is listed as Inactive, and missing directories are omitted.

**What it never does.** It doesn't change a monitor, uier or the repository, and it has no write
endpoint. It binds to `127.0.0.1` and refuses requests under another host name, so a web page you
visit can't read it. Its server fetches only the projects' site icons (not with `--no-icons`), and the page loads nothing from the internet unless you pass `--review` or saved a default review project. The browser receives a fixed set of fields,
never the state files themselves or a token, and the page renders feedback text as text. Binding
another address with `--host` makes the page readable by everyone who can reach that address.

### Machine capacity

Every monitor on a machine shares one limit on sessions working at once: 12 unless changed, on top
of each monitor's own `max=` (6 by default). Fix, follow-up, rebase and review sessions all count,
whichever monitor started them. Change it with `/uier-monitor global=16` (any project, or none), or
directly:

```bash
node <git common dir>/uier-monitor/monitor.mjs capacity            # sessions per monitor, the queue
node <git common dir>/uier-monitor/monitor.mjs capacity --max 16   # the limit for every monitor here
```

The database stores the machine limit in `maxSessions`. Before starting sessions, the orchestrator claims their slots with `monitor.mjs slot
<group>…`, in one SQLite transaction, so two monitors waking at the same moment can't both take the
last slot. A claim counts until the patch that records the session, or 15 minutes. A monitor the
machine refuses waits in a queue, oldest first; when a slot frees, its watcher wakes it
with a `capacity` event on its turn, and a monitor that got a slot goes to the back, so monitors take
turns. A woken monitor that claims nothing within 15 minutes gives its place up. Only monitors whose
watcher checked in within five minutes and that have room under their own `max` hold a place, so a
stopped, crashed or full monitor never blocks the others. A monitor nobody touched for a day holds
no slots.

## How it works

- **Gate before the model.** In T3, the local `t3 thread send` CLI lets a detached persistent watcher
  wake its existing thread only after work arrives. Saved T3 monitors automatically select detached
  persistent mode, even when an older prompt calls `watch --replace`. Use `watch --persistent --detach --thread <id>`;
  pass `--t3-cli <absolute path>` when the CLI is not on PATH. The skill verifies a live PID and
  fresh watcher heartbeat from `status` before disabling an old interval fallback. Busy threads queue the
  message without interruption. Models and provider routing are unchanged. A webhook task is an
  alternative for other harnesses (`--notify-file`, bearer URL in a file private from creation).
  Neither mode sends an idle heartbeat to the model. Notification failures retry after a minute
  without dropping events; an unconsumed wake is recovered after thirty minutes. A new urgent
  control can notify sooner. A detached process survives a terminal exit, not an OS restart;
  manual resume checks health, and an existing OS supervisor can restart a dead watcher. No system
  service is installed. When neither wake transport is available, model polling needs an explicit `--allow-model-polling` opt-in;
  checking for changes inside a scheduled model prompt does not save that prompt's tokens.
- **Waiting is a script.** `monitor.mjs watch` reads uier's event feed every minute during work
  and for 15 quiet minutes, then every five minutes while idle. New visible activity restores the
  fast cadence. Leases, hold timers, wake delivery and release checks keep their fast local cycle;
  a slower event read never delays those controls. Safety reconciliation stays every 15 minutes,
  because the feed has missed comments before. Reconciliation reads all statuses
  with `list_feedback`'s compact `view: "state"` and pages of up to 1,000 rows, following every returned
  cursor. It avoids repeated 25-row reads and display payloads. Older servers that reject this schema
  use the existing summary pages; the helper probes compact support again after a day. Authentication
  and network failures never trigger a fallback. Initial setup, cursor recovery and a truncated feed
  still force reconciliation immediately. Reconciliation compares reply counts for tracked items
  with decision `asked`/`rejected` or stage `ready`,
  including replies followed by closure. It reports increases as `reply`, deduplicates feed replies
  from the same cycle and saves the baseline in the watcher checkpoint. The first observation seeds a baseline;
  it cannot recover replies that predate that observation. Reconciliation can also wake for a
  connector reply because list summaries do not identify its author. It also follows merges and deploy
  runs on GitHub or GitLab. It exits only when something needs the orchestrator: a person's action wakes it,
  and the monitor's own uier writes don't. Persistent mode delivers that wake and keeps running.
  Ordinary events collect for ten seconds (`--batch-seconds`, maximum thirty), preserving separate
  replies, transitions and deployed PRs. Reassignment, agent removal, stop-work and auth/lease
  errors bypass the delay. Identical poll errors notify once per outage. Lease renewal continues
  during batching and while an inbox is waiting to be consumed.
- **The watcher does the bookkeeping.** It records merges in project state itself (the deploy entry,
  the PR and group state) and, when the orchestrator drafted the closing replies at approval, posts
  them once a deploy contains the merge, sets Done or asks for verification, and marks the group
  closed. These quiet events wake no one; they ride along with the next wake. It also records the In
  progress move its own agent attachment causes, rather than reporting it as drift. Without a draft
  or a token that can write, the orchestrator closes comments itself as before. When wake delivery
  fails, `status` shows it and the next context reports the gap once.
- **Merges don't wait in line.** `main` doesn't require PRs to be up to date, so a reviewed PR gets
  auto-merge at once, even when another open PR changes the same files. GitHub refuses a real
  conflict, and only then does a rebase session run. In T3 the orchestrator stops watching a PR
  once auto-merge is on; the watcher follows it and wakes the orchestrator only for failed checks,
  a conflict, requested changes or a close.
- **Recovery.** Every decision goes into project state, so a fresh session can take
  over at any time. In T3 the orchestrator starts one every 15 wakes to keep its context small: a
  fresh session starts near 100k tokens and each wake adds several thousand that every later model
  call re-reads.
  It reads `M context` once, then `M context --take` for events and changed active records, instead
  of repeatedly loading the full state. Each section prints at most 25 changed records; `more`
  identifies unread ids, which stay due on the next read. `M detail items <id>`, `groups <id>` or
  `prs <n>` fetches exact selected records, and `M detail <field>` fetches named extra state such as
  runtime evidence. Routing, scope, release restrictions and pending writes remain visible; closed
  history and transcripts remain on disk. A recovery packet is written before the inbox is drained.
- **Sessions.** Up to 6 run at once per monitor, and up to 12 across every monitor on the machine,
  so ten monitors don't start sixty sessions (see [Machine capacity](#machine-capacity)). A slot frees
  as soon as a session opens its PR; CI, merges and deploys don't hold one. Before starting one with less than 15 GiB free, the orchestrator removes
  worktrees of finished groups that are clean and fully pushed (`monitor.mjs cleanup --apply`). When
  a session hits a usage limit, its group and new sessions move to the other provider until the
  reset. Follow-ups for a PR go back to the session that wrote it while its context is fresh. Small fixes in the same area share one session and one PR, and simple
  fixes collect for two quiet minutes, up to ten minutes from the first held item or five items.
  The orchestrator triages the whole incoming batch before starting sessions, releases all due
  groups together, and starts urgent fixes or follow-ups immediately. Required checks are unchanged.
- **Models in T3.** UI work runs on the newest Claude Opus and backend work and investigations on the
  newest GPT sol. Complex UI (size L), redesigns and branding run on the newest Claude Fable at high
  when the Claude instance offers Fable (not every plan does), and on Opus at xhigh otherwise. Image
  generation runs on GPT sol at xhigh. Effort follows size: medium for simple fixes, high for
  rearrangements and new simple components, xhigh for complex work.
- **Testing.** Sessions iterate on one spec and one project, then widen once before handing over.
  The smallest fixes run typecheck and the closest test file, and CI runs the full suite. Larger
  fixes run `pnpm test` once before the PR. A session rebases only when `main` moved, and re-tests
  after a clean rebase only when the incoming commits touched its files or the lockfile. Tests were
  about 80% of session command time and rebasing under 1% (November 2026).
- **Closing.** After a deploy that contains the merge, the watcher (or the orchestrator, without a
  draft) replies with the commit, PR and session.
  Then it marks the comment done, or asks for verification when the result is a judgment call.
  uier doesn't let you verify a check your own account requested, so for your own comments the
  reply says what to check and the comment is marked done. Pass `reviewer=<account id>` to have
  another account, such as your second one, verify them instead.

## Repository notes

The skill reads this section at start. It takes precedence over what the skill detects.

- Pull requests target `main`. The only required check is **CI OK**. Squash merge, auto-merge is
  allowed, and branches are deleted on merge. PRs don't have to be up to date before merging
  (`strict: false`), and there is no merge queue.
- Deploys: `.github/workflows/deploy.yml` runs on every push to `main` except changes limited to
  `*.md`, `LICENSE`, `renovate.json`, `.github/ISSUE_TEMPLATE/**`, `.claude/**` and `.agents/**`.
  Runs coalesce: a newer push replaces a waiting run. A Pulumi plugin download that fails with
  HTTP 503 is transient. Re-run the whole run (`gh run rerun <id>`, `rerun: all`): the deploy job
  downloads a build artifact named after the attempt, so re-running only the failed jobs can't find it.
- Known flaky test: `launch.spec.ts:67` (the installation check's 5 s timeout). Re-run it once.
- Infrastructure (`infra/`, `.github/workflows/`) and secrets: open the PR, then ask before merging.
- Ports: give each session `PORT=4000+c`, where `c` is one of 104, 204, … 904. Tests start local
  stand-ins on `PORT+1000` to `PORT+9000`, so two live sessions must never share `PORT` mod 1000
  ([several checkouts side by side](development.md#several-checkouts-side-by-side)). 4004 belongs to
  `pnpm dev`, and bases ending in 50 are left for people's own runs.
- Node 26 and pnpm through corepack. Sessions started by T3 can begin on an older Node; run
  `source ~/.nvm/nvm.sh && nvm use`.
- Area notes: [apps/web](../apps/web/docs/README.md) and [packages/toolbar](../packages/toolbar/docs/README.md);
  brand rules in [BRAND.md](../packages/brand/BRAND.md). Name one to three notes in each brief.
- Files that many PRs change at once: `packages/toolbar/AGENTS.md` (one-line code-map rows only),
  `apps/web/docs/comments-inbox.md` and the toolbar's `src/i18n/*.ts` catalogs. Sessions add to them
  rather than rewrite, as the fix-session rules say.
- The pre-PR check is `pnpm test`, which needs a fresh `pnpm build`. For focused runs, see
  [while implementing](development.md#while-implementing).
- Replies name the site as `uier.io`.

## Changing the skill

Edit `plugins/uier/skills/uier-monitor/SKILL.md`, its `references/` and its `scripts/monitor.mjs`.
The monitor, dashboard and supervisor share `scripts/store.mjs`. The dashboard is
`scripts/dashboard.mjs` and includes its page. Its colours are the
values of `packages/brand/tokens.css`, and its agent marks and model names are those of
`packages/toolbar/src/agents.ts`; `dashboard.test.mjs` checks both, so change them there first.

While you work on the dashboard, run it with `--dev`:

```bash
node plugins/uier/skills/uier-monitor/scripts/dashboard.mjs --dev --open
```

Every save of `dashboard.mjs` swaps the new code in on the same port and reloads the open page, which
keeps its open cards and scroll position. A save that doesn't load is reported in the terminal and
the last good code keeps serving. Without `--dev`, an open page still reloads itself after the
dashboard restarts with different code.
`SKILL.md` holds what the orchestrator needs on every wake, since every model call re-reads it; first
start, waiting modes, the token and workflow detection live in `references/start.md`, the fix
session rules in `references/fix-session.md` and the state fields in `references/state.md`. After a
change to the script,
bump `VERSION` in it and `MONITOR_VERSION` in `SKILL.md`, then run:

```bash
node plugins/uier/skills/uier-monitor/scripts/build-script-skill.mjs
```

It rewrites the `uier-monitor-script` skill, which carries a copy of the script for installs without
the scripts folder. CI fails when that copy is out of date. The historical `.claude/skills/`
paths still resolve to these files. For plugin adapters, catalogs and releases, see
[maintain and validate](agent-plugins.md#maintain-and-validate).

When a fix session opens a PR, Session results step 3 immediately calls uier `link_feedback_pull_request` for every fixed item before review or CI. The orchestrator needs `feedback:assign`; retries use the same canonical URL. T3 PR linking alone does not attach a PR in uier. Failed attachments remain recorded for retry.

## Idle usage controls

Persistent watching sends no heartbeat to the model. An expired token reports one actionable
authentication failure and never silently starts timer polling. `--allow-model-polling` is an
explicit opt-in for a harness without a usable event transport or token; it is reported in the
watcher record and every heartbeat-only delivery increments `idleWakes`. Existing interval model
tasks must be disabled after a persistent replacement has a live PID and fresh heartbeat.

The current helper is 1.8.0. To upgrade an existing monitor, keep its state, cursor, inbox, token,
target thread, routing and release restrictions; replace only the shared helper, start it with
`watch --persistent --detach --thread <saved thread> --replace`, and verify its loaded version
and heartbeat. Do not restart explicitly stopped monitors. The compact API capability probe
falls back only for an older schema, not for authorization or network failures. Monitors on 1.8.0
claim slots under the [machine capacity](#machine-capacity) limit; a watcher started by an older
helper counts toward it but can't send `capacity` wakes until it is replaced.

The two monitor read tools return `x-uier-database-ru` when supported, covering instrumented
reads and the HTTP quota counter. This is response-time SDK charge accounting, independent of
optional diagnostic sampling. Counter TTL deletion, storage, transfer and hosting are outside
that number. Servers without the header remain compatible and show unmeasured coverage.
