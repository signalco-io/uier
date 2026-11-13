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
(`max=`, `scope=`, `also=`, provider instances) are listed in the skill.

The skills live in `plugins/uier/skills/`, with repository discovery aliases in `.claude/skills/`
and `.agents/skills/`. For another repository, [install the uier plugin](agent-plugins.md) from
this repository's Claude Code or Codex marketplace. It includes both skills and the MCP connector.
The installed Claude Code command is `/uier:uier-monitor <project>`; in Codex ask it to use
uier-monitor for the project. Installing the plugin starts no monitoring; invoking the monitor
grants the scope described in the skill. Manual skill links remain an option.

### The watcher's access token

The watcher checks uier with its own access token, so waiting costs no model tokens. When the MCP
connection has **Create access tokens**, the skill calls `create_access_token` for this project with
Read feedback, Read screenshots, Assign feedback, Change status and Reply to feedback, requesting
30 days (capped at the creating connection’s hard expiry). These operations must already
belong to the connection. The new token cannot create more tokens.

The tool returns the secret once. Set `umask 077` in the writing shell before creating the file.
The skill writes it directly to a new `0600` file in the harness scratchpad, runs `monitor.mjs token --project <id> --from-file <file>` to store it in the macOS
keychain (service `uier-mcp`, account: the project id), and deletes the file in cleanup. The secret
must never appear in chat, command arguments, logs, packets or state.json. Retries use the same key
and return metadata only. If the first response was lost, revoke the listed token before replacing it.
The token appears under Account → Coding agents → Access tokens, marked with the connection that
created it, and can be revoked there.

Without that permission or the required operations, the skill keeps the existing flow: create a token
in Account → Coding agents → Access tokens, select the project, choose Read feedback, Read screenshots,
Assign feedback, Change status and Reply to feedback, and use 30 days. In T3 Code it asks with `request_secret` and file delivery, then
imports the file with `monitor.mjs token --from-file`. Elsewhere, import a file or export
`UIER_MCP_TOKEN` in the environment that starts the coding tool. Without a token the monitor still
works, but it polls uier itself every 15 minutes, which costs more tokens.

### The working spinner

While a fix session builds, uier shows a small spinner by the agent's avatar on its comments. The
spinner is a five-minute lease that has to be renewed, and the orchestrator sleeps while sessions
run, so the watcher keeps it: when a session starts, the orchestrator writes the session's agent,
model, effort and thread id to the group's `agentLease` in `state.json`. The watcher attaches that
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

### Where its files are

Everything lives in `$(git rev-parse --git-common-dir)/uier-monitor/`, which all worktrees share and
git never commits. That folder holds `monitor.mjs`, and each project has a folder with
`state.json`, `inbox.json` and `watch.log`. `context.json` retains the last compact wake and its
delta baseline; `notification.json` tracks delivery without consuming the inbox. For a quick look:

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
find, and `--json` prints one snapshot and exits. The skill starts it too: `/uier-monitor dashboard`
(in Claude Code with the plugin, `/uier:uier-monitor dashboard`), with or without a project.

Every monitor is a card, and the cards sit side by side, so you see all of them without opening
anything. A card shows:

- **Watcher health:** running, waiting (a running watcher with nothing in progress), stopped, not
  running or not responding, with failing wake delivery and usage limits called out. Low disk space
  shows once, at the top of the page. Stopped and inactive monitors are dimmed.
- **Sessions:** how many of the monitor's slots are working.
- **Waiting on:** sessions still working, pull requests to merge, deploys to finish, a timer, events
  the orchestrator hasn't taken yet, or you. Under it, one small muted line gives the orchestrator's
  last note (what it just did); hover it for the whole note, or open the card's details to read it in full.
- **Work in progress:** one line per group under Building, In review, Pull request, Deploying or
  Blocked, with its comments, pull request, agent, time in that state and a link to the session,
  then the queued comments and what needs you (open questions, comments ready to verify, blocked
  groups and failed uier writes). A speech bubble marks links to uier comments and a pull request
  icon marks links to GitHub. The agent shows its maker's mark (Claude, OpenAI or Cursor), the model's
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
inactive.
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
`http://localhost:4780`, so the toolbar only works on the default port. The comments are in the app
under the uier workspace, and `/uier-monitor uier monitor dashboard` resolves them like any other
project's once your uier connection includes the project. Anyone else passes their own project's id; the page loads nothing from uier without the
flag.

**How it finds monitors.** The helper announces each monitor with one small file in
`~/.uier-monitor/monitors` (`UIER_MONITOR_HOME` moves the folder), written when the watcher starts
and on every `patch`. The file holds the state folder's path, the project's id and name and the
repository's name. The dashboard also looks in the checkout it runs in, so a monitor whose watcher
predates version 1.5.0 shows up when you start the dashboard from its repository. A monitor nobody
touched for a day is listed as Inactive, and one whose state folder is gone is left out.

**What it reads.** `state.json`, `watch.json`, `watch.pid`, `inbox.json`, `notification.json` and
`events.jsonl`, the activity history the helper appends to: one line for each event the watcher
finds, each wake and take, and each change of a group's state or a comment's decision or stage.
Without that history (an older watcher) the feed shows the watcher's log instead. The journal rotates
at 2 MB, keeping one earlier file.

**What it never does.** It doesn't change a monitor, uier or the repository, and it has no write
endpoint. It binds to `127.0.0.1` and refuses requests under another host name, so a web page you
visit can't read it. It loads nothing from the internet unless you pass `--review`. The browser receives a fixed set of fields,
never the state files themselves or a token, and the page renders feedback text as text. Binding
another address with `--host` makes the page readable by everyone who can reach that address.

## How it works

- **Gate before the model.** In T3, the local `t3 thread send` CLI lets a detached persistent watcher
  wake its existing thread only after work arrives. Use `watch --persistent --detach --thread <id>`;
  pass `--t3-cli <absolute path>` when the CLI is not on PATH. The skill verifies a live PID and
  fresh `watch.json.heartbeatAt` before disabling an old interval fallback. Busy threads queue the
  message without interruption. Models and provider routing are unchanged. A webhook task is an
  alternative for other harnesses (`--notify-file`, bearer URL in a file private from creation).
  Neither mode sends an idle heartbeat to the model. Notification failures retry after a minute
  without dropping events; an unconsumed wake is recovered after thirty minutes. A new urgent
  control can notify sooner. A detached process survives a terminal exit, not an OS restart;
  manual resume checks health, and an existing OS supervisor can restart a dead watcher. No system
  service is installed. When neither wake transport is available, the existing fallback remains;
  checking for changes inside a scheduled model prompt does not save that prompt's tokens.
- **Waiting is a script.** `monitor.mjs watch` reads uier's event feed every minute and the open list
  every 15 minutes, because the feed has missed comments before. Reconciliation reads all statuses
  and compares reply counts for tracked items with decision `asked`/`rejected` or stage `ready`,
  including replies followed by closure. It reports increases as `reply`, deduplicates feed replies
  from the same cycle and saves the baseline in `watch.json`. The first observation seeds a baseline;
  it cannot recover replies that predate that observation. Reconciliation can also wake for a
  connector reply because list summaries do not identify its author. It also follows merges and deploy
  runs on GitHub. It exits only when something needs the orchestrator: a person's action wakes it,
  and the monitor's own uier writes don't. Persistent mode delivers that wake and keeps running.
  Ordinary events collect for ten seconds (`--batch-seconds`, maximum thirty), preserving separate
  replies, transitions and deployed PRs. Reassignment, agent removal, stop-work and auth/lease
  errors bypass the delay. Identical poll errors notify once per outage. Lease renewal continues
  during batching and while an inbox is waiting to be consumed.
- **The watcher does the bookkeeping.** It records merges in `state.json` itself (the deploy entry,
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
- **The state file is the memory.** Every decision goes into `state.json`, so a fresh session can take
  over at any time. In T3 the orchestrator starts one every 15 wakes to keep its context small: a
  fresh session starts near 100k tokens and each wake adds several thousand that every later model
  call re-reads.
  It reads `M context` once, then `M context --take` for events and changed active records, instead
  of repeatedly loading the full state. Each section prints at most 25 changed records; `more`
  identifies unread ids, which stay due on the next read. `M detail items <id>`, `groups <id>` or
  `prs <n>` fetches exact selected records, and `M detail <field>` fetches named extra state such as
  runtime evidence. Routing, scope, release restrictions and pending writes remain visible; closed
  history and transcripts remain on disk. A recovery packet is written before the inbox is drained.
- **Sessions.** Up to 6 run at once. A slot frees as soon as a session opens its PR; CI, merges and
  deploys don't hold one. Before starting one with less than 15 GiB free, the orchestrator removes
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
The dashboard is `scripts/dashboard.mjs`: one file with its page inside, no dependencies and no
imports from `monitor.mjs`, so it also reads monitors that run an older helper. Its colours are the
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
