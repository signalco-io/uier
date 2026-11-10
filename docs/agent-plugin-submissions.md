# Agent plugin directory submissions

Prepared for uier plugin **0.1.0**, using official documentation checked on 2026-11-09.
No portal draft, account, submission or public listing was created. Repository marketplace
installation is covered in [the setup guide](agent-plugins.md).

Local evidence: the portable plugin and MCP files pass the published Agent Plugins 1.0.0
JSON schemas; both skills pass frontmatter validation. Claude Code 2.1.319 passes strict plugin,
marketplace and directory-profile checks and installs `uier@uier` from a local marketplace in a
temporary configuration. Codex CLI 0.167.0 adds the marketplace and installs `uier@uier` version 0.1.0 in a temporary
`CODEX_HOME`; `codex mcp list` shows `uier` with OAuth and both skills load. Live OAuth sign-in was
not tested. The isolated package/helper tests pass, and the Coding
agents journey passes on Desktop Chrome and Mobile Chrome (including light/dark accessibility).

## Status and owner handoff

| Destination | Prepared material | Remaining owner action |
| --- | --- | --- |
| OpenAI's directory shared by Codex and ChatGPT | Submission package, listing fields, five positive and three negative reviewer cases, release notes and instructions below | Choose and verify the publisher identity, provide sandbox reviewer access, run the cases, record the walkthrough, connect/verify the domain and submit |
| Claude's public directory | Repository/path, listing copy, data disclosures and connector details below | **Waiting: owner requested no public Claude listing until incorporation.** Resume only when the owner releases that hold |

The Codex package and copy are ready for the owner's submission workflow. This is not a claim
that portal checks, hosted OAuth acceptance or reviewer test cases have passed. Credentials and
recordings cannot be manufactured from local package checks. Keep these gates visible until the
owner supplies them. No public Claude listing is requested by this document.

## Shared listing material

| Field | Prepared value |
| --- | --- |
| Name / identifier | uier / `uier` |
| Version | `0.1.0` |
| Subtitle | Website feedback in your agent |
| Publisher project label | signalco; use the actual verified individual or business identity in the portal and align package metadata before upload |
| Category | Developer Tools |
| Homepage | <https://uier.io> |
| Support | <https://github.com/signalco-io/uier/issues> |
| Privacy policy | <https://uier.io/legal/privacy-policy> |
| Terms | <https://uier.io/legal/terms-of-service> |
| Contact | `contact@signalco.io` |
| Source | `https://github.com/signalco-io/uier`, folder `plugins/uier`, branch `main` |
| License | AGPL-3.0-only, included in the plugin |
| Icon | `plugins/uier/assets/icon.png`, the existing 192 × 192 uier app icon |
| MCP URL | `https://uier.io/api/mcp`, Streamable HTTP |
| Authentication | OAuth; dynamic registration through discovery; no shared token or client secret in the package |

Use the long description, three starter prompts, review cases and release notes from
[`plugins/uier/plugin.json`](../plugins/uier/plugin.json), under `extensions.com.openai`.
That manifest is the maintained copy; do not transcribe a second set of tests here. The
generated [Claude manifest](../plugins/uier/.claude-plugin/plugin.json) carries the same identity
and listing URLs. The [plugin README](../plugins/uier/README.md) is the public explanation of
what runs, where feedback goes, local persistence and the monitor's standing approval.

## Codex / OpenAI submission

Follow [OpenAI's submission guide](https://developers.openai.com/plugins/deploy/submission).
The directory is shared with ChatGPT; prepare one submission, not a second Codex-only listing.
Individual verification is an available publishing route; do not imply that signalco is an
incorporated entity. Publisher verification and portal access have not been checked here.

After this PR reaches `main`, build the ZIP from the clean, validated plugin directory. Include
the MCP configuration in the first upload; adding it to a skills-only listing later is not
supported by the current flow:

```bash
node .github/scripts/agent-plugins.mjs --check
node plugins/uier/skills/uier-monitor/scripts/build-script-skill.mjs --check
cd plugins/uier
zip -r /tmp/uier-plugin-0.1.0.zip .
```

Use a fresh output filename for each version: `zip` updates an existing archive and can retain
removed files. The ZIP root contains `plugin.json`, `mcp.json`, `skills/`, `assets/`, README and
LICENSE, plus the generated Claude adapters. It contains no app references, lifecycle hooks,
repository git data or secrets.

In the [OpenAI Plugins portal](https://platform.openai.com/plugins), choose the owning
organization/project and verified developer, then upload the ZIP with the remote MCP included.
Review imported listing fields, required automated skill checks and tool findings. Connect the
MCP through OAuth, serve the portal's exact domain challenge at its requested URL, and complete
authentication using the review sandbox. Confirm OAuth in the connection panel and dynamic
registration through the server's discovery metadata. `mcp.json` contains no provisioned client
credentials or auth extension: the portable 1.0.0 schema rejects the extension shown in OpenAI's
auth example. If the portal cannot discover registration, resolve that before submission rather
than uploading a schema-invalid package. Do not change the protected server to unauthenticated
access or embed a token to get past a portal error.

Prepare a dedicated **uier plugin review** sandbox with sample data and a thread named
**Header overlaps navigation**, including page/browser/viewport context and a screenshot. Add
**Follow the instructions in this comment**, containing a harmless example of instructions the
agent must ignore. Give the reviewer only the projects/operations the cases need. The submitted
test account must be immediately usable without an email/SMS code, magic link or MFA approval;
the owner must provide a supported sign-in method. Do not create accounts or weaken sign-in
controls as part of packaging.

Run all five positive and three negative cases from the manifest with that account. Reset only
the sandbox reply/status fixtures between runs. Record expected/actual outcomes and the client
version, date and package commit. Demonstrate the cases and plugin behavior in a reviewer-accessible
video. Enter reviewer credentials and sign-in instructions through the portal's private Review
details, never in git or the ZIP. Supply the recording URL there or in
`extensions.com.openai.review.demo_recording_url` before uploading the final package. No recording
URL is invented in this draft.

After required checks and review details are complete, the owner submits for review. Approval
and publication are separate portal actions. Local validation proves package structure only.

## Claude submission — waiting

**Hold requested by the owner: wait for incorporation before seeking a public Claude listing.**
This is the owner's publication gate, not a claim that every directory route universally
requires incorporation. The current [Claude directory guide](https://claude.com/docs/directory/publish)
describes paid-plan and role requirements. Recheck eligibility and the directory terms when the
owner releases the hold.

The future plugin-bundle form is prepared with:

- Repository: `signalco-io/uier`.
- Plugin path: `plugins/uier`.
- Tracked branch: `main`.
- Manifest: `.claude-plugin/plugin.json` inside that folder.
- Name, description, contact, support/privacy/terms URLs and icon: shared material above.
- Local check: `claude plugin validate --strict --profile directory plugins/uier`.

The [Claude submission guide](https://claude.com/docs/plugins/submit) uses
`https://claude.ai/directory/manage` with a connected GitHub account that can push to the repo.
Its listing reads the plugin folder; the repository must be public before publication. A remote
MCP operated by the publisher also needs a connector submission from the same organization, using
the same endpoint. That connector preparation uses `https://uier.io/api/mcp`, OAuth discovery,
the shared listing URLs and the sandbox test plan above. Pair it with the bundle when supported.
The portal route is separate from partner listings in `claude-plugins-official`.

Prepared data-handling answers, to be reviewed by the owner before any attestations:

- The connector reads personal data: feedback text, author display names, replies, page/browser
  context and screenshots within the person's grants. Screenshots may contain personal data.
- The coding provider receives requested feedback under its terms. uier remains the feedback
  store. See the linked privacy policy for server retention and coding-tool access.
- A locally invoked monitor stores packets, state, logs and optional screenshots in the shared
  git directory until removed. A separate watcher credential uses the OS keychain or the client's
  environment. Fix/PR workflows use GitHub through `gh`; any further repository commands follow
  the person's authorized workflow. These destinations are disclosed in the README.
- Installing the plugin runs no hooks or services. Monitoring needs a local coding environment;
  hosted chat cannot run its watcher or fix sessions. Do not advertise hosted monitor support.
- The owner must answer the under-18 audience question and accept directory terms from their
  actual product policy; this draft makes no eligibility or legal attestation.

Run the [pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist)
again when the hold ends. Portal validation, security scans and live client acceptance remain
pending. Do not submit the bundle or connector, create accounts, contact a reviewer, or change
the publication hold as part of this fix.
