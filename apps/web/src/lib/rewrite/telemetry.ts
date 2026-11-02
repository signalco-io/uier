import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { deploymentEnvironment } from '../app/deployment';
import { estimateTokens, knownModel, REWRITE_KNOWN_MODELS, REWRITE_PRICING, type TokenUsage } from './pricing';

export const rewriteOutcomes = ['success', 'refusal', 'truncation', 'invalid_output', 'empty_output', 'filtered_out', 'timeout', 'provider_error'] as const;
export type RewriteOutcome = typeof rewriteOutcomes[number];
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const modelSchema = z.enum([...REWRITE_KNOWN_MODELS, 'unknown']);
const tokensSchema = z.object({ model: modelSchema, input: count, output: count, cacheRead: count, cacheWrite: count, cache5m: count, cache1h: count });
export const rewriteEventSchema = z.object({
    event: z.literal('rewrite_usage'), version: z.literal(1), id: z.uuid(), timestamp: z.iso.datetime(),
    environment: z.enum(['production', 'preview', 'local', 'unknown']), requestedModel: modelSchema, returnedModel: modelSchema,
    fallback: z.boolean(), sdkAttempts: z.number().int().min(0).max(2),
    durationMs: z.number().finite().nonnegative(), stopReason: z.enum(['end_turn', 'refusal', 'max_tokens', 'other', 'unavailable']),
    outcome: z.enum(rewriteOutcomes), suggestionCount: z.number().int().min(0).max(3),
    usage: z.array(tokensSchema).max(8), pricingVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}\.\d+$/), currency: z.literal('USD'),
    estimatedUsd: z.number().finite().nonnegative().nullable(), accounting: z.enum(['known', 'partial', 'unknown']),
    limitations: z.array(z.enum(['missing_usage', 'unknown_rates_or_cache', 'sdk_retry_usage_unavailable', 'fallback_usage_incomplete', 'fallback_billing_adjustments', 'refusal_billing_unknown', 'unsupported_pricing', 'unsupported_iterations'])),
});
export type RewriteEvent = z.infer<typeof rewriteEventSchema>;
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value !== null && typeof value === 'object' ? value as ObjectValue : {};
const counter = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

function tokens(value: ObjectValue, model: unknown): TokenUsage {
    const cache = object(value.cache_creation);
    return { model: knownModel(model), input: counter(value.input_tokens), output: counter(value.output_tokens),
        cacheRead: counter(value.cache_read_input_tokens), cacheWrite: counter(value.cache_creation_input_tokens),
        cache5m: counter(cache.ephemeral_5m_input_tokens), cache1h: counter(cache.ephemeral_1h_input_tokens) };
}

/** Exactly one event for a logical service call, including calls with no usable output. */
export function rewriteEvent(input: {
    requestedModel: string; response?: unknown; outcome: RewriteOutcome; suggestionCount: number; durationMs: number; sdkAttempts: number;
}): RewriteEvent {
    const response = object(input.response), usage = object(response.usage);
    const iterations = Array.isArray(usage.iterations) ? usage.iterations : [];
    const fallback = (Array.isArray(response.content) && response.content.some(block => object(block).type === 'fallback'))
        || iterations.some(entry => object(entry).type === 'fallback_message');
    const limitations: RewriteEvent['limitations'] = [];
    const add = (reason: RewriteEvent['limitations'][number]) => { if (!limitations.includes(reason)) limitations.push(reason); };
    const records: TokenUsage[] = [];
    let estimate = 0, priced = 0;
    if (input.sdkAttempts > 1) add('sdk_retry_usage_unavailable');
    if (!response.usage) add('missing_usage');
    // Fallback credit/repricing cannot be reconciled to invoice charges from these counters alone.
    if (fallback) add('fallback_billing_adjustments');
    if (fallback && !iterations.length) add('fallback_usage_incomplete');
    // Defaults can depend on the provider workspace. Missing modifiers cannot prove global/standard rates.
    const unsupportedPricing = usage.speed !== 'standard' || usage.service_tier !== 'standard'
        || !['global', 'us'].includes(String(usage.inference_geo)) || usage.fallback_credit != null;
    if (response.usage && unsupportedPricing) add('unsupported_pricing');
    const entries = iterations.length ? iterations : response.usage ? [{ ...usage, model: response.model, type: 'message' }] : [];
    if (entries.length > 8) add('unsupported_iterations');
    for (const [index, entry] of entries.slice(0, 8).entries()) {
        const value = object(entry);
        if (!['message', 'fallback_message'].includes(String(value.type))) { add('unsupported_iterations'); continue; }
        const record = tokens(value, value.model);
        records.push(record);
        let amount = estimateTokens(record);
        // Earlier fallback refusals lack per-hop categories. Their tokens are observed, their charge is unknown.
        const earlierHop = fallback && index < entries.length - 1;
        if (record.output === 0 && (earlierHop || input.outcome === 'refusal')) {
            if (earlierHop) { amount = null; add('refusal_billing_unknown'); }
            else {
                const category = object(response.stop_details).category;
                if (!['bio', 'frontier_llm', 'reasoning_extraction'].includes(String(category))) {
                    // Recognize only documented categories. Unknown future categories need a pricing review.
                    if (category === null || ['cyber', 'general_harms'].includes(String(category))) amount = 0;
                    else { amount = null; add('refusal_billing_unknown'); }
                }
            }
        }
        if (amount === null) add('unknown_rates_or_cache');
        else if (!unsupportedPricing) { estimate += amount * (usage.inference_geo === 'us' ? 1.1 : 1); priced++; }
    }
    const known = limitations.length === 0 && priced > 0;
    const environment = deploymentEnvironment();
    return { event: 'rewrite_usage', version: 1, id: randomUUID(), timestamp: new Date().toISOString(),
        environment: environment === 'production' || environment === 'preview' ? environment
            : process.env.UIER_LOCAL === '1' || process.env.NODE_ENV === 'development' ? 'local' : 'unknown',
        requestedModel: knownModel(input.requestedModel), returnedModel: knownModel(response.model), fallback,
        sdkAttempts: input.sdkAttempts, durationMs: Math.max(0, Math.round(input.durationMs)),
        stopReason: ['end_turn', 'refusal', 'max_tokens'].includes(String(response.stop_reason))
            ? response.stop_reason as 'end_turn' | 'refusal' | 'max_tokens' : input.response ? 'other' : 'unavailable',
        outcome: input.outcome, suggestionCount: input.suggestionCount, usage: records.map(record => ({ ...record, model: knownModel(record.model) })),
        pricingVersion: REWRITE_PRICING.version, currency: 'USD', estimatedUsd: priced ? estimate : null,
        accounting: known ? 'known' : priced ? 'partial' : 'unknown', limitations };
}

/** Logging is best effort and must never change the request's result. No payload/error logging. */
export function recordRewrite(input: Parameters<typeof rewriteEvent>[0], emit: (event: RewriteEvent) => void = event => console.info(JSON.stringify(event))) {
    try { emit(rewriteEvent(input)); } catch { /* Telemetry must not fail a rewrite. */ }
}
