# AI thread titles

`src/lib/titles/` writes a short title per thread with `claude-haiku-5-5` from its first message (with its
kind, anchor words and the start of the selected text) and stores it on the comment as `aiTitle` (text, a
hash of the first message's text, model, time). Product behaviour is in
[the review workflow](../../../docs/review-workflow.md#ai-thread-titles); calls, prices and bounds in
[AI thread title costs](../../../docs/ai-title-costs.md).

| Path | What |
| --- | --- |
| `settings.ts` | `aiTitlesEnabled`: the project's `aiTitles` (`on`/`off`), else the workspace's (`aiTitles !== false`, so missing means on) |
| `model.ts` | pure: `aiTitleSource`, `currentAiTitle`/`visibleAiTitle`, `needsAiTitle`, `cleanAiTitle` |
| `generate.ts` | the Haiku request (`createAiTitleService` takes an injected `fetch` for tests) |
| `threadTitles.ts` | `queueAiTitles` (after the response), `makeAiTitle` (the write), `aiTitleCandidates` |
| `telemetry.ts` | one `ai_title_usage` event per call |
| `src/lib/afterResponse.ts` | Next.js `after()` for library code, registered by `instrumentation.ts`; nothing runs outside a request |

- **Never in the request path.** `queueAiTitles` schedules through `afterResponse` after a create
  (`createProjectComment`), every `changeComment` and reply (a thread without a current title), and a
  comments list render (`loadProjectComments`: at most `AI_TITLE_BATCH` = 10, newest first). In-flight
  threads, recent attempts and the pause after an API failure live on `globalThis` (route and page bundles
  hold separate module copies). Threads with a positive per-item `ttl` are titled only within
  `EXPIRING_THREAD_WINDOW_MS` of their last change: a write restarts Cosmos TTL.
- **The write** (`makeAiTitle`) is a conditional replace that adds only `aiTitle`: no `updatedAt`, activity,
  sync mark or notification event, and `commentRevision` ignores the field. It is dropped when the first
  message changed meanwhile. Edits of the first message (`editProjectCommentText`, `editProjectCommentItem`)
  and its deletion remove `aiTitle` in the same write. The write changes `_etag`, so open pages refresh.
- **Showing it.** Only `currentAiTitle`/`visibleAiTitle` read it: a title whose source hash no longer matches
  the first message, or with titles off, is never shown. It reaches people only through views of threads
  they can see: `ProjectCommentView.title` (rows through `commentTitle`, the thread's `ThreadTitle`, search),
  `projectFeedbackExport`'s `title` option (Copy issue, MCP packets, connected services) and MCP
  `list_feedback`. Never add it to the toolbar DTO or emails (emails carry comment text only as the opt-in
  excerpts).
- **The prompt** keeps visitor text inside tags it cannot close and says it is not instructions; the answer
  is a `{ title }` JSON schema, cleaned by `cleanAiTitle` (plain text, one line, at most 80 characters, never
  cut). Thinking is off, effort `low`, no fallbacks (Haiku has none). Events carry no text, titles or
  identifiers.
- **Settings.** Workspace settings → AI (`WorkspaceAiTitlesForm`, a switch that saves at once,
  `setWorkspaceAiTitles`); project General → Thread titles (a select in `ProjectGeneralForm`, saved with
  `updateProjectGeneralAction`). `UIER_AI_TITLES=off` stops titles for a deployment.
- **Tests.** The Anthropic stub answers title requests (model `claude-haiku-5-5`) with an empty title unless
  the first message has `[stub:title:Words]`, so other tests keep their first lines.
  `e2e/ai-titles.api.spec.ts` covers the setting, the request with an injected fetch, storing, edits,
  deletion, visibility and the bounds; `e2e/ai-titles.spec.ts` a row and the thread with a title and the
  project setting turning it off.
