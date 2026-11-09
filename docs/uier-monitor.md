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

The watcher checks uier with its own read-only access token, so waiting costs no model tokens.
Create one in uier under Account → Coding agents → Access tokens. Select the project, choose the
"Read feedback" and "Screenshots" operations, and let it run for 30 days. In T3 Code the skill asks
for the token and stores it in the macOS keychain (service `uier-mcp`, account: the project id).
Elsewhere, store it with `monitor.mjs token --project <id> --from-file <file>` or export
`UIER_MCP_TOKEN`. Without a token the monitor still works, but it polls uier itself every 15
minutes, which costs more tokens.

### Where its files are

Everything lives in `$(git rev-parse --git-common-dir)/uier-monitor/`, which all worktrees share and
git never commits. That folder holds `monitor.mjs`, and each project has a folder with
`state.json`, `inbox.json` and `watch.log`. For a quick look:

```bash
node "$(git rev-parse --path-format=absolute --git-common-dir)/uier-monitor/monitor.mjs" status --project uier00000001
```

## How it works

- **Waiting is a script.** `monitor.mjs watch` reads uier's event feed every minute and the open list
  every 15 minutes, because the feed has missed comments before. It also follows merges and deploy
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
