import { expect, test } from '@playwright/test';
import { evaluationAccounting } from '../scripts/rewrite-evaluate';
import { estimateTokens } from '../src/lib/rewrite/pricing';
import { dailyRewriteReport } from '../src/lib/rewrite/report';
import { createRewriteService, REWRITE_CANDIDATES, REWRITE_MODEL } from '../src/lib/rewrite/suggest';
import { recordRewrite, rewriteEvent, rewriteEventSchema, type RewriteEvent } from '../src/lib/rewrite/telemetry';
import { rewriteFixture, stubUsage } from './support/rewriteFixtures';

const previousKey = process.env.ANTHROPIC_API_KEY;
test.beforeAll(() => { process.env.ANTHROPIC_API_KEY = 'synthetic-key'; });
test.afterAll(() => { if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previousKey; });
const observed = (response: unknown, extra = {}) => rewriteEvent({ requestedModel: 'claude-opus-5-5', response,
    outcome: 'success', suggestionCount: 3, sdkAttempts: 1, durationMs: 10, ...extra });

test('production requests Sonnet while the comparison keeps both distinct models', async () => {
    let requestedModel: unknown;
    const events: RewriteEvent[] = [];
    await createRewriteService({ emit: event => events.push(event), fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { model: unknown };
        requestedModel = body.model;
        return Response.json(rewriteFixture('success', REWRITE_MODEL));
    } })('Synthetic selection.', undefined);
    expect(requestedModel).toBe('claude-sonnet-5-5');
    expect(REWRITE_CANDIDATES).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5']);
    expect(events[0]).toMatchObject({ requestedModel: 'claude-sonnet-5-5', returnedModel: 'claude-sonnet-5-5',
        accounting: 'known', estimatedUsd: 0.00084 });
});

test('prices input, output and mixed cache TTLs once, with explicit unknown categories', () => {
    const usage = { model: 'claude-opus-5-5', input: 100, output: 50, cacheRead: 200, cacheWrite: 40, cache5m: 30, cache1h: 10 };
    expect(estimateTokens(usage)).toBeCloseTo(0.00167, 12);
    expect(estimateTokens({ ...usage, model: 'new-model' })).toBeNull();
    expect(estimateTokens({ ...usage, model: 'toString' })).toBeNull();
    expect(estimateTokens({ ...usage, cache5m: null })).toBeNull();
    expect(estimateTokens({ ...usage, cacheWrite: 41 })).toBeNull();
    expect(estimateTokens({ ...usage, cacheWrite: 0 })).toBeNull();
    expect(estimateTokens({ ...usage, output: null })).toBeNull();
    expect(observed(rewriteFixture()).estimatedUsd).toBeCloseTo(0.00168, 12);
    const us = rewriteFixture(); us.usage = { ...stubUsage, inference_geo: 'us' };
    expect(observed(us).estimatedUsd).toBeCloseTo(0.001848, 12);
    const fast = rewriteFixture(); fast.usage = { ...stubUsage, speed: 'fast' };
    expect(observed(fast)).toMatchObject({ estimatedUsd: null, accounting: 'unknown', limitations: ['unsupported_pricing'] });
    const missingGeo = rewriteFixture(); missingGeo.usage = { ...stubUsage, inference_geo: null };
    expect(observed(missingGeo)).toMatchObject({ estimatedUsd: null, accounting: 'unknown', limitations: ['unsupported_pricing'] });
});

for (const kind of ['success', 'refusal', 'truncation', 'invalid_output', 'empty_output', 'filtered_out', 'missing_usage', 'fallback']) {
    test(`shared service accounts for ${kind} without logging content`, async () => {
        const events: RewriteEvent[] = [];
        const suggest = createRewriteService({ model: 'claude-opus-5-5', emit: event => events.push(event), fetch: async () => Response.json(rewriteFixture(kind)) });
        const result = await suggest('PRIVATE_SELECTED_TEXT', 'PRIVATE_INSTRUCTION').catch(() => 'unavailable');
        expect(events).toHaveLength(1);
        const event = events[0]!;
        expect(rewriteEventSchema.safeParse(event).success).toBe(true);
        expect(event.outcome).toBe(['missing_usage', 'fallback'].includes(kind) ? 'success' : kind);
        expect(event.sdkAttempts).toBe(1);
        if (kind === 'invalid_output') expect(result).toBe('unavailable');
        else expect(Array.isArray(result)).toBe(true);
        if (!['success', 'missing_usage', 'fallback'].includes(kind)) expect(event.suggestionCount).toBe(0);
        if (kind === 'missing_usage') expect(event).toMatchObject({ accounting: 'unknown', estimatedUsd: null, usage: [] });
        else expect(event.usage.length).toBeGreaterThan(0);
        if (kind === 'fallback') {
            expect(event).toMatchObject({ returnedModel: 'claude-sonnet-5-5', accounting: 'partial', fallback: true });
            expect(event.usage).toHaveLength(2);
            expect(event.estimatedUsd).toBeCloseTo(0.00084, 12);
        }
        const serialized = JSON.stringify(event);
        for (const secret of ['PRIVATE_', 'synthetic-key', 'A clearer page', 'msg_synthetic', 'cyber']) expect(serialized).not.toContain(secret);
    });
}

test('one logical call records SDK retry and missing failure usage, without double counting', async () => {
    const events: RewriteEvent[] = [];
    let calls = 0;
    const suggest = createRewriteService({ model: 'claude-opus-5-5', emit: e => events.push(e), fetch: async () => {
        calls++;
        return calls === 1 ? Response.json({ error: { type: 'api_error', message: 'PRIVATE_ERROR' } }, { status: 500, headers: { 'retry-after-ms': '1' } })
            : Response.json(rewriteFixture());
    } });
    await suggest('Private', undefined);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ sdkAttempts: 2, accounting: 'partial', limitations: ['sdk_retry_usage_unavailable'] });
    const failed: RewriteEvent[] = [];
    await expect(createRewriteService({ model: 'claude-opus-5-5', emit: e => failed.push(e), fetch: async () => Response.json({ error: { type: 'api_error', message: 'PRIVATE_ERROR' } },
        { status: 500, headers: { 'retry-after-ms': '1' } }) })('Private', undefined)).rejects.toMatchObject({ status: 503 });
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ outcome: 'provider_error', sdkAttempts: 2, estimatedUsd: null });
    expect(JSON.stringify(failed)).not.toContain('PRIVATE_ERROR');
});

test('timeout and telemetry failure preserve service behavior', async () => {
    const events: RewriteEvent[] = [];
    await expect(createRewriteService({ model: 'claude-opus-5-5', emit: e => events.push(e), fetch: async () => { throw new DOMException('Synthetic timeout', 'AbortError'); } })('Private', undefined)).rejects.toMatchObject({ status: 503 });
    expect(events[0]).toMatchObject({ outcome: 'timeout', accounting: 'unknown' });
    expect(await createRewriteService({ model: 'claude-opus-5-5', emit: () => { throw new Error('sink unavailable'); }, fetch: async () => Response.json(rewriteFixture()) })('Private', undefined)).toHaveLength(3);
    expect(() => recordRewrite({ requestedModel: 'claude-opus-5-5', outcome: 'provider_error', suggestionCount: 0, sdkAttempts: 1, durationMs: 1 }, () => { throw new Error(); })).not.toThrow();
});

test('refusal charging and incomplete fallback remain explicit', () => {
    const refusal = rewriteFixture('refusal'); refusal.usage = { ...stubUsage, output_tokens: 0 };
    expect(observed(refusal, { outcome: 'refusal', suggestionCount: 0 }).estimatedUsd).toBe(0);
    refusal.stop_details = { category: 'bio' };
    expect(observed(refusal, { outcome: 'refusal', suggestionCount: 0 }).estimatedUsd).toBeCloseTo(0.00048, 12);
    refusal.stop_details = { category: 'new-category' };
    expect(observed(refusal, { outcome: 'refusal', suggestionCount: 0 }).accounting).toBe('unknown');
    const fallback = rewriteFixture('fallback'); fallback.usage = { ...stubUsage };
    expect(observed(fallback).limitations).toContain('fallback_usage_incomplete');
    const unknown = rewriteFixture(); unknown.model = 'PRIVATE_CUSTOMER_IDENTIFIER';
    expect(observed(unknown)).toMatchObject({ returnedModel: 'unknown', accounting: 'unknown' });
    unknown.model = 'claude-opus-4-8';
    expect(observed(unknown)).toMatchObject({ returnedModel: 'claude-opus-4-8', estimatedUsd: null, accounting: 'unknown' });
    expect(observed(rewriteFixture('fallback', 'claude-sonnet-5-5'))).toMatchObject({
        returnedModel: 'claude-sonnet-5', fallback: true, estimatedUsd: null, accounting: 'unknown' });
});

test('a single unnamed ordinary iteration uses the serving model without adding top-level usage', () => {
    const response = rewriteFixture('nullable_iteration_model');
    response.usage = { ...response.usage as object, input_tokens: 9999, output_tokens: 9999 };
    expect(observed(response)).toMatchObject({ accounting: 'known', estimatedUsd: 0.00168,
        usage: [{ model: 'claude-opus-5-5', input: 120, output: 60 }] });
    const unpriced = { ...stubUsage, type: 'message', model: 'unpriced-model' };
    response.usage = { ...stubUsage, iterations: [unpriced] };
    expect(observed(response).accounting).toBe('unknown');
    response.usage = { ...stubUsage, iterations: [{ ...unpriced, model: null }, { ...unpriced, model: null }] };
    expect(observed(response).accounting).toBe('unknown');
    const fallback = rewriteFixture('fallback');
    fallback.usage = { ...stubUsage, iterations: [{ ...unpriced, type: 'fallback_message', model: null }] };
    expect(observed(fallback).accounting).toBe('unknown');
});

test('evaluation summaries never present unavailable charges as zero', () => {
    const missing = { event: observed(rewriteFixture('missing_usage')) };
    const known = { event: observed(rewriteFixture()) };
    expect(evaluationAccounting([missing])).toEqual({ estimatedUsd: null, accounting: 'unknown' });
    expect(evaluationAccounting([])).toEqual({ estimatedUsd: null, accounting: 'unknown' });
    expect(evaluationAccounting([missing, known])).toEqual({ estimatedUsd: 0.00168, accounting: 'partial' });
    expect(evaluationAccounting([known])).toEqual({ estimatedUsd: 0.00168, accounting: 'known' });
});

test('deployment environment uses the build-inlined context before Vercel system variables', () => {
    const previousDeployment = process.env.UIER_DEPLOYMENT_ENV, previousVercel = process.env.VERCEL_ENV;
    try {
        process.env.UIER_DEPLOYMENT_ENV = 'production'; process.env.VERCEL_ENV = 'preview';
        expect(observed(rewriteFixture()).environment).toBe('production');
        delete process.env.UIER_DEPLOYMENT_ENV;
        expect(observed(rewriteFixture()).environment).toBe('preview');
    } finally {
        if (previousDeployment === undefined) delete process.env.UIER_DEPLOYMENT_ENV; else process.env.UIER_DEPLOYMENT_ENV = previousDeployment;
        if (previousVercel === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = previousVercel;
    }
});

test('daily report separates observed tokens, estimates, invoice gaps and accounting coverage', () => {
    const one = observed(rewriteFixture()), two = observed(rewriteFixture('missing_usage'));
    const noResult = observed(rewriteFixture('truncation'), { outcome: 'truncation', suggestionCount: 0 });
    const report = dailyRewriteReport([one, one, two, noResult, { event: 'rewrite_usage', text: 'PRIVATE' }], one.timestamp.slice(0, 10), one.environment);
    expect(report).toMatchObject({ observedCalls: 3, observedSdkAttempts: 3, retainedSuggestions: 6,
        outcomes: { success: 2, truncation: 1 }, accounting: { knownCalls: 2, unknownCalls: 1, knownCallFraction: 2 / 3 },
        knownTokenTotals: { input: 240, output: 120 }, duplicateRecords: 1, rejectedRecords: 1,
        providerCharges: { status: 'unavailable', usd: null }, latencyMs: { p50: 10, p95: 10 } });
    expect(report.estimatedUsd).toBeCloseTo(0.00336, 12);
    expect(report.estimatedUsdPerUsableCall).toBeCloseTo(0.00168, 12);
    expect(JSON.stringify(report)).not.toContain('PRIVATE');
    expect(dailyRewriteReport([], '2026-11-02', 'production')).toMatchObject({ observedCalls: 0, estimatedUsd: null,
        accounting: { knownCallFraction: null }, latencyMs: { p50: null } });
});
