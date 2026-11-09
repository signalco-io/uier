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

The skill is in `.claude/skills/uier-monitor/`, and Codex finds it through `.agents/skills/`. To use it
with another repository, link `uier-monitor` and `uier-monitor-script` into `~/.claude/skills/` and
`~/.codex/skills/`.

### The watcher's access token

The watcher checks uier with its own access token, so waiting costs no model tokens. When the MCP
connection has **Create access tokens**, the skill calls `create_access_token` for this project with
Read feedback, Read screenshots and Assign feedback, requesting 30 days (capped at the creating
connection’s hard expiry). These operations must already
belong to the connection. The new token cannot reply, change status or create more tokens.

The tool returns the secret once. Set `umask 077` in the writing shell before creating the file.
The skill writes it directly to a new `0600` file in the harness scratchpad, runs `monitor.mjs token --project <id> --from-file <file>` to store it in the macOS
keychain (service `uier-mcp`, account: the project id), and deletes the file in cleanup. The secret
must never appear in chat, command arguments, logs, packets or state.json. Retries use the same key
and return metadata only. If the first response was lost, revoke the listed token before replacing it.
The token appears under Account → Coding agents → Access tokens, marked with the connection that
created it, and can be revoked there.

Without that permission or the required operations, the skill keeps the existing flow: create a token
in Account → Coding agents → Access tokens, select the project, choose Read feedback, Read screenshots
and Assign feedback, and use 30 days. In T3 Code it asks with `request_secret` and file delivery, then
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
attaches it rather than the orchestrator. Its token can't change status, so the orchestrator moves
the comment to In progress. With a token without "Assign feedback", or without a token, the
orchestrator attaches agents itself as before and there is no spinner; the watcher says so once.

### Where its files are

Everything lives in `$(git rev-parse --git-common-dir)/uier-monitor/`, which all worktrees share and
git never commits. That folder holds `monitor.mjs`, and each project has a folder with
`state.json`, `inbox.json` and `watch.log`. For a quick look:

```bash
node "$(git rev-parse --path-format=absolute --git-common-dir)/uier-monitor/monitor.mjs" status --project uier00000001
```

## How it works

- **Waiting is a script.** `monitor.mjs watch` reads uier's event feed every minute and the open list
  every 15 minutes, because the feed has missed comments before. Reconciliation reads all statuses
  and compares reply counts for tracked items with decision `asked`/`rejected` or stage `ready`,
  including replies followed by closure. It reports increases as `reply`, deduplicates feed replies
  from the same cycle and saves the baseline in `watch.json`. The first observation seeds a baseline;
  it cannot recover replies that predate that observation. Reconciliation can also wake for a
  connector reply because list summaries do not identify its author. It also follows merges and deploy
  runs on GitHub. It exits only when something needs the orchestrator: a person's action wakes it,
  and the monitor's own uier writes don't.
- **The state file is the memory.** Every decision goes into `state.json`, so a fresh session can take
  over at any time. In T3 the orchestrator starts one about every 40 wakes to keep its context small.
- **Sessions.** Up to 6 run at once. A slot frees as soon as a session opens its PR; CI, merges and
  deploys don't hold one. Small fixes in the same area share one session and one PR, and simple
  fixes wait up to 10 minutes for others to join them.
- **Models in T3.** UI work runs on the newest Claude Opus and backend work and investigations on the
  newest GPT sol. Image generation runs on GPT sol at xhigh, redesign and branding on Opus at xhigh.
  Effort follows size: medium for simple fixes, high for rearrangements and new simple components,
  xhigh for complex work.
- **Testing.** The smallest fixes run typecheck and the closest test file, and CI runs the full suite.
  Larger fixes run `pnpm test` once before the PR.
- **Closing.** After a deploy that contains the merge, it replies with the commit, PR and session.
  Then it marks the comment done, or asks for verification when the result is a judgment call.
  uier doesn't let you verify a check your own account requested, so for your own comments the
  reply says what to check and the comment is marked done. Pass `reviewer=<account id>` to have
  another account, such as your second one, verify them instead.

## Repository notes

The skill reads this section at start. It takes precedence over what the skill detects.

- Pull requests target `main`. The only required check is **CI OK**. Squash merge, auto-merge is
  allowed, and branches are deleted on merge.
- Deploys: `.github/workflows/deploy.yml` runs on every push to `main` except changes limited to
  `*.md`, `LICENSE`, `renovate.json`, `.github/ISSUE_TEMPLATE/**`, `.claude/**` and `.agents/**`.
  Runs coalesce: a newer push replaces a waiting run. A Pulumi plugin download that fails with
  HTTP 503 is transient, so re-run the failed jobs.
- Infrastructure (`infra/`, `.github/workflows/`) and secrets: open the PR, then ask before merging.
- Ports: give each session `PORT=4000+c`, where `c` is one of 104, 204, … 904. Tests start local
  stand-ins on `PORT+1000` to `PORT+9000`, so two live sessions must never share `PORT` mod 1000
  ([several checkouts side by side](development.md#several-checkouts-side-by-side)). 4004 belongs to
  `pnpm dev`, and bases ending in 50 are left for people's own runs.
- Node 26 and pnpm through corepack. Sessions started by T3 can begin on an older Node; run
  `source ~/.nvm/nvm.sh && nvm use`.
- Area notes: [apps/web](../apps/web/docs/README.md) and [packages/toolbar](../packages/toolbar/docs/README.md);
  brand rules in [BRAND.md](../packages/brand/BRAND.md). Name one to three notes in each brief.
- The pre-PR check is `pnpm test`, which needs a fresh `pnpm build`. For focused runs, see
  [while implementing](development.md#while-implementing).
- Replies name the site as `uier.io`.

## Changing the skill

Edit `.claude/skills/uier-monitor/SKILL.md` and `scripts/monitor.mjs`. After a change to the script,
bump `VERSION` in it and `MONITOR_VERSION` in `SKILL.md`, then run:

```bash
node .claude/skills/uier-monitor/scripts/build-script-skill.mjs
```

It rewrites the `uier-monitor-script` skill, which carries a copy of the script for installs without
the scripts folder. CI fails when that copy is out of date.

When a fix session opens a PR, Session results step 3 immediately calls uier `link_feedback_pull_request` for every fixed item before review or CI. The orchestrator needs `feedback:assign`; retries use the same canonical URL. T3 PR linking alone does not attach a PR in uier. Failed attachments remain recorded for retry.
