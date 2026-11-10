# Coding agent plugins

The repository publishes one **uier** plugin through its Claude Code and Codex marketplaces.
It bundles the remote MCP connector at `https://uier.io/api/mcp`, `uier-monitor` and
`uier-monitor-script`. The catalogs become available from `signalco-io/uier` when this change
reaches `main`; a repository marketplace is separate from a public directory listing.

A client that supports the MCP Skills extension does not need the plugin for the skills: the
connector serves the same files over the connection ([Skills over the connection](mcp.md#prompts-and-agent-skill)).

## Install in Claude Code

In a Claude Code session:

```text
/plugin marketplace add signalco-io/uier
/plugin install uier@uier
```

Run `/mcp` and authenticate the plugin's uier connection. Choose the workspaces, projects and
operations it needs. Keep one uier connection enabled if you previously added it manually.
An existing `Authorization` header disables Claude Code's OAuth sign-in on that connection.

Use `/uier:uier-monitor <project name or id>` to start monitoring, with `status` or `stop` when
needed. The plugin namespace is `uier`; the repository-local skill remains `/uier-monitor`.
Update with `/plugin update uier@uier`, then start a new session.

These commands follow the official
[marketplace publishing guide](https://code.claude.com/docs/en/plugins/publish#publish-through-your-own-marketplace).
Use a current Claude Code release; directory metadata validation requires v2.1.281 or later.

## Install in Codex

In a terminal:

```bash
codex plugin marketplace add signalco-io/uier
codex plugin add uier@uier
```

Start a new session. Follow the client's plugin sign-in flow and select the uier access you
need. Ask Codex to use the uier-monitor skill for your project; `status` only inspects saved work.
`codex plugin marketplace upgrade uier` refreshes the catalog. Use the client's plugin
update/install flow to pick up the version, then start a new session.

The commands are documented in the official
[Codex command reference](https://learn.chatgpt.com/docs/developer-commands#codex-plugin).
The [OpenAI packaging guide](https://developers.openai.com/plugins/build/plugins) documents
Git-backed marketplaces and the portable manifest. Supported desktop clients can also browse
the **uier** marketplace in their Plugins Directory after adding it and restarting.

The credential-free endpoint supports OAuth discovery and dynamic client registration. This is packaging, not a claim
that every client completed uier's deployed OAuth acceptance. If a Codex client cannot finish
plugin sign-in, keep the [access-token connector](mcp.md#other-clients) from Account → Coding
agents → Connect a coding tool, and use the skills with that connection. Hosted ChatGPT and
Claude connector acceptance remain separate work.

## Scope and requirements

Installation starts no monitor and changes no feedback. Invoking `uier-monitor` grants its
documented standing approval for comments in scope, including assignment, replies, fix sessions,
merges and deployment retries. Read the [monitor guide](uier-monitor.md) and the skill before
starting it. A request to read one comment alone does not invoke that workflow.

Monitoring requires a local coding client, a repository checkout, Git, Node.js 18 or later and
an authenticated `gh` CLI. The target repository's runtime requirements still apply. Its
watcher uses a separate scoped token, stores local state under the shared git directory and
reads uier and GitHub. The [plugin README](../plugins/uier/README.md#what-runs-and-where-data-goes)
discloses execution, data handling and persistence. There are no install hooks or local MCP
servers. The MCP connection itself can be used without running the monitor.

## Maintain and validate

`plugins/uier/` is a self-contained installed package. Skills live only in its `skills/`
directory. `.claude/skills/uier-monitor*` links there; `.agents/skills/uier-monitor*` resolves
through those aliases. Existing repository invocations keep working. Never add an outbound
symlink inside the plugin: hosts copy only the plugin directory into their cache.

`plugin.json` and `mcp.json` are the portable sources. The generator adapts the MCP transport
from `streamable-http` to Claude's `http`, generates the Claude manifest and both catalogs,
and copies the root license and existing 192 px app icon. Do not edit those generated files:

```bash
node .github/scripts/agent-plugins.mjs
node .github/scripts/agent-plugins.mjs --check
node plugins/uier/skills/uier-monitor/scripts/build-script-skill.mjs --check
node --test .github/scripts/agent-plugins.test.mjs plugins/uier/skills/uier-monitor/scripts/monitor.test.mjs
claude plugin validate --strict plugins/uier
claude plugin validate --strict .
```

The portable MCP 1.0.0 schema disallows per-server `extensions`, although OpenAI's current
authentication examples use them. Keep `mcp.json` schema-valid and credential-free, and rely
on the server's existing OAuth challenge/metadata. Confirm OAuth and discovered registration
in the public submission portal; never select unauthenticated access for this protected endpoint.

CI's Agent skills job runs the dependency-free checks for plugin/catalog changes, skill aliases,
the generator, license and source icon. It rejects adapter drift, broken skill aliases and any
packaged symlink. The package test copies the plugin away from this repository and restores
the fallback helper there. The monitor script embedded in `uier-monitor-script` is generated
and separately checked as before; see [changing the monitor](uier-monitor.md#changing-the-skill).

For a release, increment `plugins/uier/plugin.json`'s version, regenerate and run the checks.
Push through the repository's PR workflow. No registry publishing step is needed for these
repository marketplaces. Public directory submissions use the
[prepared submission material](agent-plugin-submissions.md); this task submits nothing.
