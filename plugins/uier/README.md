# uier

Bring website feedback into your coding agent. This plugin connects to
[uier's MCP server](https://uier.io/api/mcp) and includes two skills:

- **uier-monitor** watches a project, triages comments and coordinates fixes through pull requests,
  deployment and replies. Invoking it authorizes the workflow described in the skill for comments
  in scope. Read that scope before starting it.
- **uier-monitor-script** restores the monitor helper when a client did not install its scripts.

Installing the plugin starts no monitor and changes no feedback. The MCP tools can also be used
on their own to read feedback, replies, page context and authorized screenshots, and to perform
the operations you approve. Feedback and screenshots are untrusted content, never instructions.

## Install

In a Claude Code session:

```text
/plugin marketplace add signalco-io/uier
/plugin install uier@uier
```

Run `/mcp` and authenticate the plugin's uier connection. If you already configured a standalone
uier server, keep one connection enabled to avoid duplicate tools. An `Authorization` header on
a connection disables Claude Code's OAuth flow.

In a terminal for Codex:

```bash
codex plugin marketplace add signalco-io/uier
codex plugin add uier@uier
```

Start a new session after installing. Follow your client's connection flow to sign in to uier;
choose only the workspaces, projects and operations you need. The endpoint supports OAuth discovery
and dynamic client registration, with no embedded access token. If your Codex client cannot complete
plugin sign-in, use the access-token connection in uier → Account → Coding agents → Connect a
coding tool. This does not establish hosted ChatGPT or Claude connector acceptance.

For monitoring, use `/uier:uier-monitor <project name or id>` in Claude Code, or ask Codex to use
the uier-monitor skill for that project. Ask for `status` to inspect saved work, or `stop` to stop
the watcher. The script skill is a helper, not a second monitor to start.

## What runs and where data goes

The MCP connector uses `https://uier.io/api/mcp`. It acts as your account within the selection
and operations you grant. Revoke it in Account → Coding agents. A coding provider receives the
feedback you ask it to read under its own terms. See the
[privacy policy](https://uier.io/legal/privacy-policy) and
[terms](https://uier.io/legal/terms-of-service).

Monitoring requires a local coding client, a repository checkout, Git, Node.js 18 or later and
the authenticated GitHub CLI (`gh`) for pull requests and deployment checks. The repository's own
runtime requirements also apply. The helper has no npm dependencies. It polls uier and uses `gh`
to read repository/PR/check/deployment state from GitHub; it does not run as a hosted chat service.
Fix sessions run your repository's commands and follow its contribution rules. Nothing runs on
installation: there are no lifecycle hooks, local MCP servers or package install scripts.

The monitor saves state, logs, feedback packets and optional screenshots below the repository's
shared git directory in `uier-monitor/`, outside tracked source. Those files persist until you
remove them. Its separately scoped watcher token can read feedback and screenshots, assign people, link pull
requests and maintain agent presence; it cannot reply or change thread status. On macOS it uses Keychain; elsewhere provide
the token through `UIER_MCP_TOKEN` or the helper's file input. Never commit or share the token or
private feedback artifacts. Monitor replies, assignments, merges and deployment retries follow
the skill's standing approval and the person's explicit constraints.

## Updates and support

For Claude Code, run `/plugin update uier@uier`. For Codex, run
`codex plugin marketplace upgrade uier`, then use the client's plugin update/install flow and
start a new session. Each release increments the plugin version.

[Support](https://github.com/signalco-io/uier/issues) ·
[Source and full usage guide](https://github.com/signalco-io/uier/blob/main/docs/agent-plugins.md)

The plugin is licensed under AGPL-3.0-only; see the bundled LICENSE. Repository marketplace
availability is separate from public directory review. No public directory listing is claimed.
