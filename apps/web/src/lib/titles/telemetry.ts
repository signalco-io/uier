import { randomUUID } from 'node:crypto';
import { logEnvironment } from '../app/deployment';

export const aiTitleOutcomes = ['success', 'refusal', 'truncation', 'invalid_output', 'empty_output', 'filtered_out', 'timeout', 'provider_error'] as const;
export type AiTitleOutcome = typeof aiTitleOutcomes[number];
/** What asked for the title: a new thread, a change to one, or a list that showed one without a title */
export type AiTitleTrigger = 'new' | 'change' | 'shown';

/**
 * Standard, global, synchronous Claude API USD per million tokens, checked on 9 November 2026 at
 * https://platform.claude.com/docs/en/about-claude/pricing (prompts of at most 100K tokens; a title
 * prompt is a few hundred). An estimate, never an invoice. See docs/ai-title-costs.md.
 */
export const AI_TITLE_PRICING = { checkedOn: '2026-11-09', model: 'claude-haiku-5-5', input: 0.1, output: 0.5 } as const;

export type AiTitleEvent = {
    event: 'ai_title_usage';
    version: 1;
    id: string;
    timestamp: string;
    environment: ReturnType<typeof logEnvironment>;
    trigger: AiTitleTrigger;
    requestedModel: string;
    returnedModel: string;
    sdkAttempts: number;
    durationMs: number;
    stopReason: 'end_turn' | 'refusal' | 'max_tokens' | 'other' | 'unavailable';
    outcome: AiTitleOutcome;
    inputTokens: number | null;
    outputTokens: number | null;
    /** Null without usage counters; a retried call lacks the earlier attempt's usage (`partial`) */
    estimatedUsd: number | null;
    accounting: 'known' | 'partial' | 'unknown';
};

const counter = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
// Never copy an arbitrary provider string into a log
const knownModel = (model: unknown) => model === AI_TITLE_PRICING.model ? AI_TITLE_PRICING.model : 'unknown';

/** One event per service call. No message text, title, identifier or raw error. */
export function aiTitleEvent(input: { trigger: AiTitleTrigger; requestedModel: string; response?: unknown; outcome: AiTitleOutcome; durationMs: number; sdkAttempts: number }): AiTitleEvent {
    const response = input.response !== null && typeof input.response === 'object' ? input.response as Record<string, unknown> : {};
    const usage = response.usage !== null && typeof response.usage === 'object' ? response.usage as Record<string, unknown> : {};
    const inputTokens = counter(usage.input_tokens);
    const outputTokens = counter(usage.output_tokens);
    const priced = inputTokens !== null && outputTokens !== null && knownModel(response.model) === AI_TITLE_PRICING.model;
    return {
        event: 'ai_title_usage', version: 1, id: randomUUID(), timestamp: new Date().toISOString(), environment: logEnvironment(),
        trigger: input.trigger, requestedModel: knownModel(input.requestedModel), returnedModel: knownModel(response.model),
        sdkAttempts: input.sdkAttempts, durationMs: Math.max(0, Math.round(input.durationMs)),
        stopReason: ['end_turn', 'refusal', 'max_tokens'].includes(String(response.stop_reason))
            ? response.stop_reason as 'end_turn' | 'refusal' | 'max_tokens' : input.response ? 'other' : 'unavailable',
        outcome: input.outcome, inputTokens, outputTokens,
        estimatedUsd: priced ? (inputTokens * AI_TITLE_PRICING.input + outputTokens * AI_TITLE_PRICING.output) / 1_000_000 : null,
        accounting: !priced ? 'unknown' : input.sdkAttempts > 1 ? 'partial' : 'known'
    };
}

/** Logging is best effort and never changes the result */
export function recordAiTitle(input: Parameters<typeof aiTitleEvent>[0], emit: (event: AiTitleEvent) => void = event => console.info(JSON.stringify(event))) {
    try { emit(aiTitleEvent(input)); } catch { /* Telemetry must not fail a title. */ }
}
