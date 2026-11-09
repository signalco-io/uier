# AI thread title usage and costs

Thread titles ([review workflow](review-workflow.md#ai-thread-titles)) are written by
`claude-haiku-5-5` through [`src/lib/titles/generate.ts`](../apps/web/src/lib/titles/generate.ts), with the
`ANTHROPIC_API_KEY` that rewrite suggestions already use. No infrastructure changed: without the key (previews,
local development) no title is asked for and every thread shows its first line.

## What a call is

One Messages API request per thread and first-message version: the system prompt (about 400 tokens), the
message (at most 1,000 characters), what it was left on in words, the start of the selected text (at most 300
characters) and its kind. Thinking is off, effort is `low` and the answer is a JSON object with one short
title; `max_tokens` is 200. The SDK retries a failed attempt once (10 seconds per attempt, 20 seconds in all).
Haiku has no server-side refusal fallback, so a declined request simply gives no title. The prompt is shorter
than the smallest cacheable prefix, so no prompt caching is used.

Typical usage is about 600 input and 25 output tokens; the most a single attempt can use is about 1,000 input
and 200 output tokens.

## Prices and estimates

Rates checked on 9 November 2026 against the official
[Claude API price table](https://platform.claude.com/docs/en/about-claude/pricing): Claude Haiku 5.5 is
**$0.10** per million input tokens and **$0.50** per million output tokens for prompts of at most 100K tokens.
`AI_TITLE_PRICING` in [`telemetry.ts`](../apps/web/src/lib/titles/telemetry.ts) holds them; update both when
the price or the model changes.

| Case | Estimate |
| --- | --- |
| One typical title | about $0.00007 |
| One attempt at its largest | $0.0002 (a retried call at most $0.0004) |
| 1,000 existing threads, once | about $0.07, at most $0.40 |
| 10,000 new threads a month | about $0.70 |

These are estimates, not an invoice. Reconcile them with the Anthropic Console's usage and cost reports.

## What bounds the number of calls

- **New threads** ask once, after the response is sent (Next.js `after()`), so saving a comment never waits
  for the model. Comment creation keeps its existing rate limits.
- **An edit of the first message** drops the title in the same write and asks once for the new text. Other
  changes ask only when a thread has no title for its current first message. A thread a member renamed asks
  for none while their title is set.
- **Titles that lost a quote** (made before quotes belonging to a title were kept) are made again once, through
  the same bounded list batches; only titles with unbalanced quotes and no `cleanup` mark qualify.
- **Lists** (a project's comments, My work) ask for at most 10 threads per render (`AI_TITLE_BATCH`), newest
  first, three at a time, after the response. A written title changes the thread, so an open page refreshes
  and the next render asks for the next 10: a project's older threads get titles once, in steps, while someone
  looks at them.
- On each server instance, a thread that is being titled is not asked for twice, an answer without a title
  (declined, empty, too long, invalid) is not asked again for that text for a day, and a timeout or API error
  waits 10 minutes and pauses list requests on that instance for 5 minutes.
- Threads with their own expiry (uier's public project, 90 days after the last change) are titled only within
  10 minutes of a change, so a title never restarts their retention by more than that.
- Titles off for a workspace or a project, or `UIER_AI_TITLES=off` on the deployment, ask for nothing.

## Operational events

Each call logs one JSON `ai_title_usage` v1 event: a random id, time, deployment environment, what asked for
it (`new`, `change` or `shown`), allowlisted requested and returned model, SDK attempts, duration, bounded stop
reason, outcome (`success`, `refusal`, `truncation`, `invalid_output`, `empty_output`, `filtered_out`,
`timeout`, `provider_error`), input and output token counts, and the estimate with its accounting (`known`,
`partial` after an SDK retry, `unknown` without usage or with another model). No message, selected text,
title, URL, project, thread or person identifier, raw error or refusal explanation is logged. SDK payload
logging is off. Logs follow the hosting retention.

## Turning it off

- A workspace admin turns titles off in Workspace settings → AI; a project admin chooses On, Off or the
  workspace setting in the project's General settings. Off hides stored titles too.
- Operators can stop every title without touching rewrite suggestions by setting `UIER_AI_TITLES=off` on the
  Vercel project (not managed by Pulumi). Removing `ANTHROPIC_API_KEY` stops both.
- Reverting the feature leaves an `aiTitle` field on titled threads; nothing reads it, it never leaves the
  comments container and it is deleted with its thread.
